import { redis, context, scheduler, ScheduledJob, Post, PostFlairWidget } from '@devvit/web/server';
import { getTodaysSchedule, getGameData, NHLGame } from './api';
import { formatThreadTitle, formatThreadBody } from './formatter';
import { UPDATE_INTERVALS, GAME_STATES, REDIS_KEYS } from './constants';
import { SubredditConfig } from '../../types';
import { createThread, updateThread } from '../../threads';
import { Logger } from '../../utils/Logger';
import { Router } from 'express'; // TODO: Used?

// Get SubredditConfig
export async function getSubredditConfig(subredditName: string): Promise<SubredditConfig | null> {
    const logger = await Logger.Create('Jobs - Get Config');

    const configStr = await redis.hGet('subredditConfig', subredditName);
    if (!configStr) return null;

    logger.info(`Returning subreddit config for ${subredditName}`);
    logger.debug(`Config details: ${JSON.parse(configStr)}`);

    return JSON.parse(configStr) as SubredditConfig;
}

// --------------- Daily Game Check -----------------
export async function dailyGameCheckJob(subredditName: string) {
    const logger = await Logger.Create('Jobs - Daily Game Check');
    logger.debug(`Running daily game check...`);
    
    const config = await getSubredditConfig(subredditName);
    if (!config || !config.nhl) {
        logger.debug(`No subreddit config returned for ${subredditName}`);
        return; 
    } 

    const teamAbbrev = config.nhl.teamAbbreviation;
    const todayGames = await getTodaysSchedule(fetch);
    logger.info(`Team: ${teamAbbrev}, Games: ${todayGames}`);

    // Filter by the subreddit's NHL team
    const game = todayGames.find(
        g => g.homeTeam.abbrev === teamAbbrev || g.awayTeam.abbrev === teamAbbrev
    );

    if (!game){
        logger.info(`No game found for ${context.subredditName}: ${teamAbbrev}`)
        return;
    } 

    // Else, game found
    logger.info(`Game found for sub: ${context.subredditName} - ${game.awayTeam} at ${game.homeTeam}`);

    // Determine pre-game thread creation time
    const startTime = new Date(game.startTimeUTC).getTime();
    const scheduleTime = new Date(startTime - UPDATE_INTERVALS.PREGAME_THREAD_OFFSET);

    await scheduleCreateGameThread(subredditName, game.id, scheduleTime);
    
    }

// --------------- Create Game Thread -----------------
export async function createGameThreadJob(gameId: number, subredditName: string) {
    const logger = await Logger.Create('Jobs - Create Game Thread'); // TODO: Implement logging
    
    // Fetch game data
    const { game } = await getGameData(gameId, fetch);

    // Format title & body
    const title = await formatThreadTitle(game, subredditName);
    const body = await formatThreadBody(game, subredditName);

    // Create thread on reddit with subredditName, title, body
    const result = await createThread(
        context,
        title,
        body
    )

    if (result.success) {
        const post = result.post!;
        logger.info(`Created post ID: ${post.id}`)
        await redis.set(`game:${gameId}:threadId`, post.id); // TODO: clear this at some point! (game in OFF state?)\
        // Schedule first live update 
        const updateTime = UPDATE_INTERVALS.LIVE_GAME_DEFAULT;
        await scheduleNextLiveUpdate(subredditName, post, game.id, updateTime);

    } else {
        logger.error(`Failed to create post:`, result.error);
    }
}

// --------------- Next Live Update -----------------
export async function nextLiveUpdateJob(subredditName: string, post: Post, gameId: number) {
    const logger = await Logger.Create('Jobs - Next Live Update'); // TODO: Implement logging
    
    const threadId = await redis.get(`game:${gameId}:threadId`);
    if (!threadId) return;

    const { game, modified } = await getGameData(gameId, fetch, await redis.get(REDIS_KEYS.GAME_ETAG(gameId)));

    // Update the ETag in Redis
    if (modified) await redis.set(REDIS_KEYS.GAME_ETAG(gameId), game.id.toString());

    // Format update text
    const body = await formatThreadBody(game, subredditName);

    // Update thread
    const result = await updateThread( post.id, body);
    // TODO: Use result

    // Schedule next live update
    if (game.gameState !== GAME_STATES.FINAL) {
        let nextUpdateDelay = UPDATE_INTERVALS.LIVE_GAME_DEFAULT;
        // TODO: if intermission, adjust to INTERMISSION interval
        await scheduleNextLiveUpdate(subredditName, post, gameId, nextUpdateDelay);
    } else {
        // Game finished
        // TODO: schedule postgame thread if enabled
        redis.del(`game:${gameId}:threadId`);
    }
}

// --------------- Scheduling helpers -----------------
async function scheduleCreateGameThread(subredditName: string, gameId: number, scheduledTime: Date) {
    const job: ScheduledJob = {
        id: `create-thread-${gameId}`,
        name: 'create-game-thread',
        data: { gameId, subredditName },
        runAt: scheduledTime,
    };

    await scheduler.runJob(job);
}

async function scheduleNextLiveUpdate(subredditName: string, post: Post, gameId: number, secondsFromNow: number) {
    const postId = post.id;
    const job: ScheduledJob = {
        id: `update-${gameId}-${Date.now()}`,
        name: 'next-live-update',
        data: { subredditName, postId, gameId },
        runAt: new Date(Date.now() + (secondsFromNow * 1000)),
    };

    await scheduler.runJob(job);
}