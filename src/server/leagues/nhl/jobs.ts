import { redis, context, scheduler, ScheduledJob, Post, PostFlairWidget } from '@devvit/web/server';
import { getTodaysSchedule, getGameData, NHLGame } from './api';
import { formatThreadTitle, formatThreadBody } from './formatter';
import { UPDATE_INTERVALS, GAME_STATES, REDIS_KEYS } from './constants';
import { getSubredditConfig } from '../../config';
import { createThread, updateThread } from '../../threads';
import { Logger } from '../../utils/Logger';

// --------------- Daily Game Check -----------------
export async function dailyGameCheckJob() {
    const logger = await Logger.Create('Jobs - Daily Game Check');
    logger.debug(`Running daily game check...`);
    
    const config = await getSubredditConfig(context.subredditName);
    if (!config || !config.nhl) {
        logger.debug(`No subreddit config returned for ${context.subredditName}`);
        return; 
    } 

    const subredditName = context.subredditName;
    const teamAbbrev = config.nhl.teamAbbreviation;
    const todayGames = await getTodaysSchedule(fetch); // FIX: Add try/catch
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
    const startTime = new Date(game.startTimeUTC).getTime(); //NOTE: could fail if API format changes?
    const scheduleTime = new Date(startTime - UPDATE_INTERVALS.PREGAME_THREAD_OFFSET);
    const gameId = game.id;

    logger.debug(`Calling scheduleCreateGameThread with subreddit:${subredditName}, gameId: ${gameId}, time: ${scheduleTime.toISOString()}`);
    await scheduleCreateGameThread(subredditName, gameId, scheduleTime);
    
    }

// --------------- Create Game Thread -----------------
export async function createGameThreadJob(gameId: number, subredditName: string) {
    const logger = await Logger.Create('Jobs - Create Game Thread');
    
    // Fetch game data
    const { game } = await getGameData(gameId, fetch);
    
    // Check if thread already exists for this game
    const existingThreadId = await redis.get(REDIS_KEYS.GAME_THREAD_ID(gameId));
    
    if (existingThreadId) {
        logger.info(`Gameday thread already exists (ID: ${existingThreadId}) for game ${gameId}. Skipping creation.`);
        
        // Still need to ensure updates are scheduled if game is live
        if (game.gameState !== GAME_STATES.FINAL && game.gameState !== GAME_STATES.OFF) {
            const updateTime = new Date(Date.now() + (UPDATE_INTERVALS.LIVE_GAME_DEFAULT));
            await scheduleNextLiveUpdate(subredditName, existingThreadId, game.id, updateTime);
        }
        return;
    }

    // Format title & body
    const title = await formatThreadTitle(game, subredditName);
    const body = await formatThreadBody(game, subredditName);

    // Create thread on reddit
    const result = await createThread(context, title, body);

    if (result.success) {
        const post = result.post!;
        logger.info(`Created post ID: ${post.id}`);
        
        // Store the post ID in Redis
        await redis.set(REDIS_KEYS.GAME_THREAD_ID(gameId), post.id);

        // Schedule live updates if game is ongoing
        if (game.gameState !== GAME_STATES.FINAL && game.gameState !== GAME_STATES.OFF){
            const updateTime = new Date(Date.now() + (UPDATE_INTERVALS.LIVE_GAME_DEFAULT));
            await scheduleNextLiveUpdate(subredditName, post.id, game.id, updateTime);
        }
    } else {
        logger.error(`Failed to create post: ${result.error}`);
    }
}

// --------------- Create Post-game Thread -----------------
export async function createPostgameThreadJob(gameId: number, subredditName: string) {
    const logger = await Logger.Create('Jobs - Create Post-game Thread');
    
    // Check if postgame thread already exists
    const existingPgtId = await redis.get(REDIS_KEYS.POSTGAME_THREAD_ID(gameId));
    if (existingPgtId) {
        logger.info(`Postgame thread already exists (ID: ${existingPgtId}) for game ${gameId}. Skipping.`);
        return;
    }

    const { game } = await getGameData(gameId, fetch);
    const title = await formatThreadTitle(game, subredditName);
    const body = await formatThreadBody(game, subredditName);

    const result = await createThread(
        context,
        title,
        body
    )

    if (result.success) {
        const post = result.post!;
        logger.info(`Created Post-game ID: ${post.id}`)
        await redis.set(REDIS_KEYS.POSTGAME_THREAD_ID(gameId), post.id);
    } else {
        logger.error(`Failed to create post-game thread:`, result.error);
    }
}

// --------------- Next Live Update -----------------
export async function nextLiveUpdateJob(gameId: number) {
    const logger = await Logger.Create('Jobs - Next Live Update'); // TODO: Implement logging
    
    const subredditName = context.subredditName;
    const postId = await redis.get(REDIS_KEYS.GAME_THREAD_ID(gameId));
    if (!postId) {
        logger.error(`Invalid postId`);
        return;
    }

    // FIX: Check that post is actually live on reddit somehow, 
    // if not, cancel and drop redis of game
    // daily check will fix if necessary

    // Check for game data changes and update if modified
    const currentEtag = await redis.get(REDIS_KEYS.GAME_ETAG(gameId));
    let game: NHLGame;
    let etag: string | undefined;
    let modified: boolean;
    
    try {
        const result = await getGameData(gameId, fetch, currentEtag);
        game = result.game;
        etag = result.etag;
        modified = result.modified;
    } catch (error) {
        logger.error(`Failed to fetch game data for game ${gameId}: ${error instanceof Error ? error.message : String(error)}`);
        
        // Reschedule another attempt in case of transient error
        const retryTime = new Date(Date.now() + 60000);
        logger.info(`Rescheduling update attempt for game ${gameId} at ${retryTime.toISOString()}`);
        await scheduleNextLiveUpdate(subredditName, postId, gameId, retryTime);
        return;
    }

    if (modified) {
        // Store new etag
        if (etag) await redis.set(REDIS_KEYS.GAME_ETAG(gameId), etag);
        
        // Format and update thread
        const body = await formatThreadBody(game, subredditName);
        const result = await updateThread(postId as Post["id"], body);
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
            await scheduleCreatePostgameThread(subredditName, gameId, scheduledTime);
        }       
        // Either way, drop the game from redis
        await redis.del(REDIS_KEYS.GAME_THREAD_ID(gameId));
        await redis.del(REDIS_KEYS.GAME_ETAG(gameId));
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

async function scheduleCreatePostgameThread(subredditName: string, gameId: number, scheduledTime: Date) {
    const logger = await Logger.Create('Jobs - Schedule Create Post-game Thread');
    
    const jobId = `create-postgame-${gameId}`;
    const job: ScheduledJob = {
        id: jobId,
        name: 'create-postgame-thread',
        data: { subredditName, gameId },
        runAt: scheduledTime,
    };

    try {
        logger.info(`Attempting to schedule post-game job ${jobId} at ${scheduledTime.toISOString()}`);
        await scheduler.runJob(job);
        logger.info(`Successfully scheduled ${jobId}`);
    } catch (error) {
        logger.error(`Failed to schedule post-game job ${jobId}: ${error instanceof Error ? error.message : String(error)}`);
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