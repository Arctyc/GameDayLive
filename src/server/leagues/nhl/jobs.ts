import { redis, context, scheduler, ScheduledJob, Post, PostFlairWidget } from '@devvit/web/server';
import { getTodaysSchedule, getGameData, NHLGame } from './api';
import { formatThreadTitle, formatThreadBody } from './formatter';
import { UPDATE_INTERVALS, GAME_STATES, REDIS_KEYS } from './constants';
import { getSubredditConfig } from '../../config';
import { createThread, updateThread } from '../../threads';
import { Logger } from '../../utils/Logger';

// --------------- Daily Game Check -----------------
export async function dailyGameCheckJob(subredditName: string) {
    const logger = await Logger.Create('Jobs - Daily Game Check');
    logger.debug(`Running daily game check...`);
    
    const config = await getSubredditConfig(context.subredditName);
    if (!config || !config.nhl) {
        logger.debug(`No subreddit config returned for ${subredditName}`);
        return; 
    } 

    const teamAbbrev = config.nhl.teamAbbreviation;
    const todayGames = await getTodaysSchedule(fetch);
    const todayGamesIds = todayGames.map(g => g.id).join(', ');
    logger.info(`Team: ${teamAbbrev}, Games: ${todayGamesIds}`);

    // Filter by the subreddit's NHL team
    const game = todayGames.find(
        g => g.homeTeam.abbrev === teamAbbrev || g.awayTeam.abbrev === teamAbbrev
    );

    if (!game){
        logger.info(`No game found for ${context.subredditName}: ${teamAbbrev}`)
        return;
    } 

    // Else, game found
    logger.info(`Game found for sub: ${context.subredditName} - ${game.awayTeam.abbrev} at ${game.homeTeam.abbrev}`);

    // Determine pre-game thread creation time
    const startTime = new Date(game.startTimeUTC).getTime();
    const scheduleTime = new Date(startTime - UPDATE_INTERVALS.PREGAME_THREAD_OFFSET);
    const gameId = game.id;

    logger.debug(`Calling scheduleCreateGameThread with subreddit:${subredditName}, gameId: ${gameId}, time: ${scheduleTime.toISOString()}`);
    await scheduleCreateGameThread(subredditName, gameId, scheduleTime);
    
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
        await redis.set(`game:${gameId}:threadId`, post.id);

        // Only schedule live updates if game is ongoing
        if (game.gameState !== GAME_STATES.FINAL && game.gameState !== GAME_STATES.OFF){
            // Schedule first live update 
            const updateTime = new Date(Date.now() + (UPDATE_INTERVALS.LIVE_GAME_DEFAULT));
            await scheduleNextLiveUpdate(subredditName, post.id, game.id, updateTime);
        } 

    } else {
        logger.error(`Failed to create post:`, result.error);
    }
}

// --------------- Next Live Update -----------------
export async function nextLiveUpdateJob(subredditName: string, gameId: number) {
    const logger = await Logger.Create('Jobs - Next Live Update'); // TODO: Implement logging
    
    const postId = await redis.get(`game:${gameId}:threadId`);
    if (!postId) {
        logger.error(`Invalid postId`);
        return;
    }
    // FIX: Check that post is actually live on reddit somehow, if not, cancel and drop redis of game

    const { game, modified } = await getGameData(gameId, fetch, await redis.get(REDIS_KEYS.GAME_ETAG(gameId)));

    // Update the ETag in Redis
    if (modified) await redis.set(REDIS_KEYS.GAME_ETAG(gameId), game.id.toString());

    // Only update if modified
    if (modified){
        // Format update text
        const body = await formatThreadBody(game, subredditName);
        // Update thread
        const result = await updateThread( postId as Post["id"], body);
        // TODO: Use result
    }    

    // Schedule next live update
    if (game.gameState !== GAME_STATES.FINAL && game.gameState !== GAME_STATES.OFF) {

        // Set updateTime for now + default delay in seconds
        let updateTime: Date = new Date(Date.now() + (UPDATE_INTERVALS.LIVE_GAME_DEFAULT));

        // If intermission, delay update until nearly over
        if (game.clock?.inIntermission) {
            const intermissionRemaining = game.clock.secondsRemaining;
            if (intermissionRemaining > 60) {
                logger.debug(`Game is in intermission`);
                updateTime = new Date(Date.now() + ((intermissionRemaining * 1000)-UPDATE_INTERVALS.INTERMISSION));
            }
        }
        
        // IF OT/SO use OT/SO interval
        if (game.periodDescriptor?.periodType == "OT" || game.periodDescriptor?.periodType == "SO" ){
            updateTime = new Date(Date.now() + (UPDATE_INTERVALS.OVERTIME_SHOOTOUT));
        } 

        // Schedule
        await scheduleNextLiveUpdate(subredditName, postId, gameId, updateTime);

    } else {
        // Game finished
        // TODO: schedule postgame thread if enabled
        const config = await getSubredditConfig(context.subredditName);
        if (config?.enablePostgameThreads){
            const scheduledTime = new Date(Date.now());
            await scheduleCreateGameThread(subredditName, gameId, scheduledTime);
        }       
        // Either way, drop the game from redis
        redis.del(`game:${gameId}:threadId`);
    }
}

// --------------- Scheduling helpers -----------------
async function scheduleCreateGameThread(subredditName: string, gameId: number, scheduledTime: Date) {
    const logger = await Logger.Create('Jobs - Schedule Create Game Thread');
    
    const jobId = `create-thread-${gameId}`;
    const job: ScheduledJob = {
        id: jobId,
        name: 'create-game-thread',
        data: { subredditName, gameId },
        runAt: scheduledTime,
    };

    try {
        logger.info(`Attempting to schedule job ${jobId} for ${scheduledTime.toISOString()}. (Current time: ${new Date().toISOString()})`);
        
        // Check if scheduled time is future
        if (scheduledTime.getTime() < Date.now()) {
            logger.warn(`Warning: scheduledTime ${scheduledTime.toISOString()} is in the past. Job may run immediately or fail.`);
        }

        await scheduler.runJob(job);
        logger.info(`Successfully scheduled ${jobId}`);

    } catch (error) {
        logger.error(`Failed to schedule ${jobId}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function scheduleNextLiveUpdate(subredditName: string, postId: string, gameId: number, updateTime: Date) {
    const logger = await Logger.Create('Jobs - Schedule Update Game Thread');

    const jobId = `update-${gameId}-${Date.now()}`;

    const job: ScheduledJob = {
        id: jobId,
        name: 'next-live-update',
        data: { subredditName, gameId, postId },
        runAt: updateTime,
    };

    try {
        logger.info(`Attempting to schedule update: ${jobId} at ${updateTime.toISOString()}`);

        // Check if scheduled time is future
        if (updateTime.getTime() < Date.now()) {
            logger.warn(`Warning: scheduledTime ${updateTime.toISOString()} is in the past. Job may run immediately or fail.`);
        }

        await scheduler.runJob(job);
        logger.info(`Successfully scheduled ${jobId}`);

    } catch (error) {
        logger.error(`Failed to schedule ${jobId}: ${error instanceof Error ? error.message : String(error)}`);
    }
}