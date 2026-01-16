import { redis, context, scheduler, ScheduledJob, Post, reddit } from '@devvit/web/server';
import { getTodaysSchedule, getGameData, NHLGame } from './api';
import { formatThreadTitle, formatThreadBody } from './formatter';
import { UPDATE_INTERVALS, GAME_STATES, REDIS_KEYS } from './constants';
import { getSubredditConfig } from '../../config';
import { tryCleanupThread, tryCreateThread, tryUpdateThread, findRecentThreadByName } from '../../threads';
import { NewJobData, UpdateJobData } from '../../types';
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
    const todayGames = await getTodaysSchedule(fetch); // TODO:FIX: Add try/catch
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
    const scheduleTime = new Date(startTime - UPDATE_INTERVALS.PREGAME_THREAD_OFFSET); // TODO: Feature: Add subreddit specific modifier * 2 = 2 hours before
    const gameId = game.id;

    logger.debug(`Calling scheduleCreateGameThread with subreddit:${subredditName}, gameId: ${gameId}, time: ${scheduleTime.toISOString()}`);
    await scheduleCreateGameThread(subredditName, game, scheduleTime);
    
    }

// --------------- Create Game Thread -----------------
export async function createGameThreadJob(gameId: number) {
    const logger = await Logger.Create('Jobs - Create Game Thread');
    
    const subredditName = context.subredditName;

    // Fetch game data
    const { game } = await getGameData(gameId, fetch);
    
    // Ensure no existing thread for game
    try {
        // Check redis for game thread lock
        const existingThreadId = await redis.get(REDIS_KEYS.GAME_THREAD_ID(gameId));
        
        if (existingThreadId) {
            logger.debug(`Found redis lock for game ${gameId}`);
            // Check for actual post on reddit
            const foundPost = await reddit.getPostById(existingThreadId as Post["id"]);
            
            if (!foundPost) {
                // Thread not found on reddit, cleanup stale reference and recreate
                logger.warn(`Thread ${existingThreadId} in Redis but not on Reddit. Cleaning up.`);
                await cleanup(existingThreadId, game.id);
                // Continue to creation logic below
            } else {
                // Thread exists on reddit
                logger.info(`Gameday thread already exists (ID: ${existingThreadId}) for game ${gameId}. Skipping creation.`);                
                // Check if game is over
                const gameIsOver = game.gameState === GAME_STATES.FINAL || game.gameState === GAME_STATES.OFF;
                
                if (gameIsOver) {
                    // Run cleanup, don't post new
                    logger.debug(`Tried to create thread for game that's over.`);
                    await cleanup(existingThreadId, game.id);
                    
                    // Check for PGT
                    const pgt = await redis.get(REDIS_KEYS.POSTGAME_THREAD_ID(gameId))
                    logger.debug(`Checking for Post-game thread...`);
                    if (pgt) {
                        // Clean up stale thread
                        logger.debug(`PGT found, cleaning up Redis...`);
                        await cleanup(pgt, game.id);
                    } else {
                        // TODO: If game ended < X time ago
                        // Create PGT
                        logger.debug(`No PGT found, scheduling new.`);
                        await scheduleCreatePostgameThread(game, new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT));
                    }
                    return;
                }

                // Game is still ongoing - check for live update jobs
                const jobs = await scheduler.listJobs();
                const thisGameJobs = jobs.filter(job => 
                    job.data?.gameId === gameId && 
                    job.name === 'next-live-update'
                );

                if (thisGameJobs.length > 0) {
                    // Live update job already exists for this game
                    logger.info(`Live update job already scheduled for game ${gameId}`);
                    return;
                }

                // Game is ongoing but no live update jobs exist - schedule one
                const updateTime = new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT);
                await scheduleNextLiveUpdate(subredditName, existingThreadId as Post["id"], game.id, updateTime);
                return;
            }
        }

    } catch (err) {
        logger.error(`Error checking existing thread. Proceeding with creation - duplicate may occur.`, err);
    }
    // No existing thread found

    // Format title & body
    const title = await formatThreadTitle(game);
    const body = await formatThreadBody(game);

    // Create thread on reddit
    const result = await tryCreateThread(context, title, body);

    if (result.success) {
        const post = result.post!;
        logger.info(`Created post ID: ${post.id}`);

        // Store postId in Redis
        await redis.set(REDIS_KEYS.GAME_THREAD_ID(gameId), post.id);

        // Schedule live updates
        if (!game.gameState || game.gameState !== GAME_STATES.FINAL && game.gameState !== GAME_STATES.OFF){
            
            // Game is upcoming
            let updateTime = new Date(game.startTimeUTC);

            if (game.gameState == GAME_STATES.LIVE || game.gameState == GAME_STATES.CRIT){
                // Game is ongoing now, update at regular interval
                updateTime = new Date(Date.now() + (UPDATE_INTERVALS.LIVE_GAME_DEFAULT));
            }

            await scheduleNextLiveUpdate(subredditName, post.id, game.id, updateTime);
        }
    } else {
        logger.error(`Failed to create post: ${result.error}`);
    }
}

// --------------- Create Post-game Thread -----------------
export async function createPostgameThreadJob(gameId: number) {
    const logger = await Logger.Create('Jobs - Create Post-game Thread');
    
    // Check if postgame thread already exists
    const existingPgtId = await redis.get(REDIS_KEYS.POSTGAME_THREAD_ID(gameId));
    if (existingPgtId) {
        logger.info(`Postgame thread already exists (ID: ${existingPgtId}) for game ${gameId}. Skipping.`);
        return;
    }

    const { game } = await getGameData(gameId, fetch);
    const title = await formatThreadTitle(game);
    const body = await formatThreadBody(game);

    // Create thread on reddit
    const result = await tryCreateThread(context, title, body)

    if (result.success) {
        const post = result.post!;
        logger.info(`Created Post-game ID: ${post.id}`)

        // Store postId in Redis
        await redis.set(REDIS_KEYS.POSTGAME_THREAD_ID(gameId), post.id);
        // TODO: schedule cleanup for 12 hours
        
    } else {
        logger.error(`Failed to create post-game thread:`, result.error);
    }
}

// --------------- Next Live Update -----------------
export async function nextLiveUpdateJob(gameId: number) {
    const logger = await Logger.Create('Jobs - Next Live Update');
    
    const subredditName = context.subredditName;
    const postId = await redis.get(REDIS_KEYS.GAME_THREAD_ID(gameId));
    if (!postId) {
        logger.error(`Invalid postId`);
        return;
    }

    // FIX: Check that post is actually live on reddit, 
    // if not, cancel and drop redis of game
    // daily check will fix if necessary
    const existingPost = await reddit.getPostById(postId as Post["id"])
    if (!existingPost) {
        await cleanup(postId as Post["id"], gameId);
    }

    // Check for game data changes and update if modified
    const currentEtag = await redis.get(REDIS_KEYS.GAME_ETAG(gameId));
    let game: NHLGame | undefined;
    let etag: string | undefined;
    let modified: boolean;
    
    try {
        const result = await getGameData(gameId, fetch, currentEtag);
        game = result.game;
        etag = result.etag;
        modified = result.modified;
    } catch (err) {
        logger.error(`Failed to fetch game data for game ${gameId}: ${err instanceof Error ? err.message : String(err)}`);
        
        // Reschedule another attempt in case of transient error
        const retryTime = new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT);
        logger.info(`Rescheduling update attempt for game ${gameId} at ${retryTime.toISOString()}`);
        await scheduleNextLiveUpdate(subredditName, postId, gameId, retryTime);
        return;
    }

    if (!game) {
        logger.error(`Game data is null. Game: ${gameId}`);
        await scheduleNextLiveUpdate(subredditName, postId, gameId, new Date(Date.now() + (UPDATE_INTERVALS.LIVE_GAME_DEFAULT * 2)));
        return;
    }

    if (modified) {
        // Store new etag
        if (etag) await redis.set(REDIS_KEYS.GAME_ETAG(gameId), etag);
        
        // Format and update thread
        const body = await formatThreadBody(game);
        const result = await tryUpdateThread(postId as Post["id"], body);
        if (!result.success) {
            logger.error(`Thread update failed for post ${postId}: ${result.error}`);

            // Reschedule another attempt in case of transient Reddit/API error
            const retryTime = new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT);
            logger.info(`Rescheduling update attempt for game ${gameId} at ${retryTime.toISOString()}`);
            await scheduleNextLiveUpdate(subredditName, postId, gameId, retryTime);
            return;
        }

    }

    // Schedule next live update
    if (!game.gameState || game.gameState !== GAME_STATES.FINAL && game.gameState !== GAME_STATES.OFF) {

        // Set updateTime for now + default delay in seconds
        let updateTime: Date = new Date(Date.now() + (UPDATE_INTERVALS.LIVE_GAME_DEFAULT));

        /* NOTE: Disabled, Keep intermission time remaining on thread unless
        // If intermission, delay update until nearly over
        if (game.clock?.inIntermission) {
            const intermissionRemaining = game.clock.secondsRemaining;
            if (intermissionRemaining > (UPDATE_INTERVALS.INTERMISSION / 1000)) {
                logger.debug(`Game is in intermission`);
                updateTime = new Date(Date.now() + ((intermissionRemaining * 1000)-UPDATE_INTERVALS.INTERMISSION));
            }
        }
        */
        
        // IF OT/SO use quicker interval
        if (game.periodDescriptor?.periodType == "OT" || game.periodDescriptor?.periodType == "SO" ){
            updateTime = new Date(Date.now() + (UPDATE_INTERVALS.OVERTIME_SHOOTOUT));
        } 

        // Schedule
        await scheduleNextLiveUpdate(subredditName, postId, gameId, updateTime);

    } else {
        // Game finished
        // TODO:FIX: schedule postgame thread only if enabled (offload method?)
        const config = await getSubredditConfig(context.subredditName);
        if (config?.enablePostgameThreads){
            logger.info(`Game ended. Scheduling PGT.`);
            const scheduledTime = new Date(Date.now());
            await scheduleCreatePostgameThread(game, scheduledTime);
        }       
        // Either way, drop the game
        await cleanup(postId, game.id);
    }
}

// --------------- Scheduling helpers -----------------

// -------- Schedule Create Game Thread --------
async function scheduleCreateGameThread(subredditName: string, game: NHLGame, scheduledTime: Date) {
    const logger = await Logger.Create('Jobs - Schedule Create Game Thread');

    const now = new Date();
    const gameId = game.id;
    const threadTitle = await formatThreadTitle(game);
    const jobTitle = `GDT-${game.id}`;

    const staleGameAge = UPDATE_INTERVALS.LATE_SCHEDULE_THRESHOLD;

    if (scheduledTime < now) {
        const ageMs = now.getTime() - scheduledTime.getTime();

        // Scheduled start is in the past, but not stale
        if (ageMs <= staleGameAge) {
            scheduledTime = now;
        } else {
            logger.warn(`Tried to create game day thread for stale game. Trying PGT instead.`);
            await scheduleCreatePostgameThread(game, now);
            return;
        }
    }

    // only schedule if no same job exists // TODO: Move to own function with thread check
    const existingJob = await redis.get(`job:${jobTitle}`);
    if (existingJob){
        logger.warn(`Job ${jobTitle} already exists. Skipping scheduling.`);
        return;
    }

    const foundThread = await findRecentThreadByName(threadTitle);
    if (foundThread){
        logger.warn(`Postgame thread matching title ${threadTitle} already exists. Skipping scheduling.`);
        return;
    }

    const jobData: NewJobData = { subredditName, gameId, jobTitle }
    const job: ScheduledJob = {
        id: `create-thread-${gameId}`,
        name: 'create-game-thread',
        data: jobData,
        runAt: scheduledTime,
    };

    logger.debug(`Job data: ${JSON.stringify(jobData)}`);

    try {
        logger.info(`Attempting to schedule job ${jobTitle} for ${scheduledTime.toISOString()}`);

        const jobId = await scheduler.runJob(job);
        // Store jobId in Redis
        await redis.set(REDIS_KEYS.SCHEDULED_JOB_ID(gameId), jobId);
        logger.info(`Successfully scheduled job ID: ${jobId} | title: ${jobTitle}`);
        logger.debug(`time: ${scheduledTime.toISOString()} | now: ${new Date(Date.now()).toISOString()}`);

    } catch (err) {
        logger.error(`Failed to schedule ${jobTitle}: ${err instanceof Error ? err.message : String(err)}`);
    }
}

// -------- Schedule Create Postgame Thread --------
async function scheduleCreatePostgameThread(game: NHLGame, scheduledTime: Date) {
    const logger = await Logger.Create('Jobs - Schedule Create Post-game Thread');
    
    const gameId = game.id;
    const subredditName = context.subredditName;
    const threadTitle = await formatThreadTitle(game);
    const jobTitle = `PGT-${gameId}`;

    // TODO: Verify enabled in settings

    // Only schedule if no same job exists
    const existingJob = await redis.get(`job:${jobTitle}`);
    if (existingJob){
        logger.warn(`Job ${jobTitle} already exists. Skipping scheduling.`)
        return;
    }

    // Only schedule if no same THREAD exists
    const foundThread = await findRecentThreadByName(threadTitle);
    if (foundThread){
        logger.warn(`Postgame thread matching title ${threadTitle} already exists. Skipping scheduling.`);
        return;
    }
    
    const jobData: NewJobData = { subredditName, gameId, jobTitle }
    const job: ScheduledJob = {
        id: `create-postgame-${gameId}`,
        name: 'create-postgame-thread',
        data: jobData,
        runAt: scheduledTime,
    };

    logger.debug(`Job data: ${JSON.stringify(jobData)}`);

    try {
        logger.info(`Attempting to schedule job ${jobTitle} at ${scheduledTime.toISOString()}`);

        const jobId = await scheduler.runJob(job);
        // Store jobId in Redis
        await redis.set(REDIS_KEYS.SCHEDULED_JOB_ID(gameId), jobId);

        logger.info(`Successfully scheduled job ID: ${jobId} | title: ${jobTitle}`);
    } catch (err) {
        logger.error(`Failed to schedule job ${jobTitle}: ${err instanceof Error ? err.message : String(err)}`);
    }
}

// -------- Schedule Next Live Update --------
async function scheduleNextLiveUpdate(subredditName: string, postId: string, gameId: number, updateTime: Date) {
    const logger = await Logger.Create('Jobs - Schedule Live Update');

    const jobTitle = `Update-${gameId}`;

    const jobData: UpdateJobData = { subredditName, gameId, postId, jobTitle }

    const job: ScheduledJob = {
        id: `update-${gameId}`,
        name: 'next-live-update',
        data: jobData,
        runAt: updateTime,
    };

    logger.debug(`Job data: ${JSON.stringify(jobData)}`);

    try {
        logger.debug(`Attempting to schedule update: ${jobTitle} at ${updateTime.toISOString()}`);

        // Check if scheduled time is future
        if (updateTime.getTime() < Date.now()) {
            logger.warn(`Warning: scheduledTime ${updateTime.toISOString()} is in the past. Job may run immediately or fail.`);
        }

        const jobId = await scheduler.runJob(job);
        // Store jobId in Redis
        await redis.set(REDIS_KEYS.SCHEDULED_JOB_ID(gameId), jobId);
        logger.info(`Successfully scheduled job ID: ${jobId} | title: ${jobTitle}`);

    } catch (err) {
        logger.error(`Failed to schedule ${jobTitle}: ${err instanceof Error ? err.message : String(err)}`);
    }
}

/* NOTE: Adds simplicity, removes utility
async function checkExistingJobandThread(jobTitle: string, threadTitle: string): Promise<Boolean>{
    const logger = await Logger.Create(`Jobs - Check Existing`);

    const existingJob = await redis.get(`job:${jobTitle}`);
    if (existingJob){
        logger.warn(`Job ${jobTitle} already exists. Skipping scheduling.`);
        return true;
    }

    const foundThread = await findRecentThreadByName(threadTitle);
    if (foundThread){
        logger.warn(`Postgame thread matching title ${threadTitle} already exists. Skipping scheduling.`);
        return true;
    }
    return false;
}
*/

async function cleanup(postId: string, gameId: number){
    const logger = await Logger.Create(`Jobs - Cleanup`);

    try {
        logger.info(`Cleaning up thread: ${postId}...`);
        await tryCleanupThread(postId as Post["id"]);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`tryCleanupThread failed: ${message}`);
        return; 
    }

    try {
        logger.info(`Cleaning up Redis keys...`);
        await redis.del(
            REDIS_KEYS.GAME_THREAD_ID(gameId),
            REDIS_KEYS.GAME_ETAG(gameId)
        );
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Redis deletion failed for game ${gameId}: ${message}`);
    }
}