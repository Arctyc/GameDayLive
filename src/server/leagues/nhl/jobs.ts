import { redis, context, scheduler, ScheduledJob, Post, reddit } from '@devvit/web/server';
import { getTodaysSchedule, getGameData, NHLGame } from './api';
import { formatThreadTitle, formatThreadBody } from './formatter';
import { UPDATE_INTERVALS, GAME_STATES, REDIS_KEYS, JOB_NAMES, COMMENTS } from './constants';
import { getSubredditConfig } from '../../config';
import { tryCleanupThread, tryCreateThread, tryUpdateThread, tryAddComment } from '../../threads';
import { NewJobData, SubredditConfig, UpdateJobData, CleanupJobData } from '../../types';
import { Logger } from '../../utils/Logger';
import { getJobData } from '../../utils/jobs';
import { stringify } from 'node:querystring';
import { sendModmail } from '../../modmail';

// --------------- Daily Game Check -----------------
export async function dailyGameCheckJob() {
    const logger = await Logger.Create('Jobs - Daily Game Check');
    
    const attemptKey = REDIS_KEYS.DAILY_CHECK_ATTEMPTS();
    const attemptNumber = parseInt(await redis.get(attemptKey) || '0');
    
    logger.debug(`Running daily game check (attempt ${attemptNumber + 1})...`);

    try {
        const config = await getSubredditConfig(context.subredditName);
        if (!config || !config.nhl) {
            logger.debug(`No subreddit config returned for ${context.subredditName}`);
            return; 
        } 

        const subredditName = context.subredditName;
        const teamAbbrev = config.nhl.teamAbbreviation;
        
        let todayGames: NHLGame[];
        try {
            todayGames = await getTodaysSchedule(fetch);
        } catch (err) {
            logger.error(`Failed to fetch today's schedule: ${err instanceof Error ? err.message : String(err)}`);
            
            // Retry with exponential backoff
            if (attemptNumber < 5) {
                const backoffMs = Math.min(60000 * Math.pow(2, attemptNumber), UPDATE_INTERVALS.RETRY_MAX_TIME);
                const retryTime = new Date(Date.now() + backoffMs);
                
                // Increment attempt counter in Redis
                await redis.set(attemptKey, String(attemptNumber + 1));
                await redis.expire(attemptKey, 7200); // 2 hours TTL
                
                logger.info(`Rescheduling daily game check at ${retryTime.toISOString()}`);
                await scheduleDailyGameCheck(retryTime);
            } else {
                logger.error(`Failed to fetch schedule after ${attemptNumber + 1} attempts. Giving up.`);
                await redis.del(attemptKey); // Clear attempts
            }
            return;
        }
        
        // Success - clear attempt counter
        await redis.del(attemptKey);
        
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
        await scheduleCreateGameThread(subredditName, game, scheduleTime);
        
    } catch (err) {
        logger.error(`Daily game check failed: ${err instanceof Error ? err.message : String(err)}`);
        
        // Retry with exponential backoff for unexpected errors
        if (attemptNumber < 5) {
            const backoffMs = Math.min(60000 * Math.pow(2, attemptNumber), 1800000); // Max 30 min
            const retryTime = new Date(Date.now() + backoffMs);
            
            // Increment attempt counter in Redis
            await redis.set(attemptKey, String(attemptNumber + 1));
            await redis.expire(attemptKey, 7200); // 2 hours TTL
            
            logger.info(`Rescheduling daily game check at ${retryTime.toISOString()}`);
            await scheduleDailyGameCheck(retryTime);
        } else {
            logger.error(`Daily game check failed after ${attemptNumber + 1} attempts. Giving up.`);
            await redis.del(attemptKey); // Clear attempts
        }
    }
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
        const existingThreadId = await redis.get(REDIS_KEYS.GAME_TO_THREAD_ID(gameId));
        if (existingThreadId) {
            logger.debug(`Found redis lock for game ${gameId}`);
            
            // Check for actual post on reddit
            const foundPost = await reddit.getPostById(existingThreadId as Post["id"]);
            if (!foundPost) {
                // Thread not found on reddit, cleanup stale reference and recreate
                logger.warn(`Thread ${existingThreadId} in Redis but not on Reddit. Cleaning up.`);
                await tryCleanupThread(existingThreadId as Post["id"]);
                // Continue to creation logic below
            } else {
                // Thread exists on reddit
                const deleted = foundPost.isRemoved();
                if (deleted) {
                    logger.info(`Gameday thread ID: ${existingThreadId} was deleted. Cleaning up.`);
                    await tryCleanupThread(existingThreadId as Post["id"]);
                } else {
                    logger.info(`Gameday thread already exists (ID: ${existingThreadId}) for game ${gameId}. Skipping creation.`); 
                }

                // Check if game is over
                const gameIsOver = game.gameState === GAME_STATES.FINAL || game.gameState === GAME_STATES.OFF; 
                if (gameIsOver) {
                    // Run cleanup, don't post new
                    logger.debug(`Tried to create thread for game that's over.`);
                    await tryCleanupThread(existingThreadId as Post["id"]);
                    
                    // Check for PGT
                    const existingPostgameThreadId = await redis.get(REDIS_KEYS.GAME_TO_PGT_ID(gameId))
                    logger.debug(`Checking for Post-game thread...`);
                    if (existingPostgameThreadId) {
                        // Clean up stale thread
                        logger.debug(`PGT found, cleaning up Redis...`);
                        await tryCleanupThread(existingPostgameThreadId as Post["id"]);
                    } else {
                        // TODO: If game ended < X time ago?
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
                    job.name === JOB_NAMES.NEXT_LIVE_UPDATE,
                );

                if (thisGameJobs.length > 0) {
                    // Live update job already exists for this game
                    logger.info(`Live update job already scheduled for game ${gameId}`);
                    return;
                }

                // Game is ongoing, and thread already exists but no live update jobs exist - schedule one
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
        await redis.set(REDIS_KEYS.GAME_TO_THREAD_ID(gameId), post.id);
        await redis.expire(REDIS_KEYS.GAME_TO_THREAD_ID(gameId), REDIS_KEYS.EXPIRY);
        await redis.set(REDIS_KEYS.THREAD_TO_GAME_ID(post.id), gameId.toString());
        await redis.expire(REDIS_KEYS.THREAD_TO_GAME_ID(post.id), REDIS_KEYS.EXPIRY);
        

        // Schedule live updates
        if (!game.gameState || game.gameState !== GAME_STATES.FINAL && game.gameState !== GAME_STATES.OFF){
            
            // Game is upcoming
            let updateTime = new Date(game.startTimeUTC);

            if (game.gameState == GAME_STATES.LIVE || game.gameState == GAME_STATES.CRIT){
                // Game is ongoing, update at regular interval
                updateTime = new Date(Date.now() + (UPDATE_INTERVALS.LIVE_GAME_DEFAULT));
            }

            await scheduleNextLiveUpdate(subredditName, post.id, game.id, updateTime);
        }
    } else {
        await sendModmail(`Game day thread creation failed`,
`GameDayLive has detected an error creating the game day thread. This is most likely due to a reddit server glitch.  
  
If this is true, please re-save your configuration to attempt posting it again.`)

        logger.error(`Failed to create post: ${result.error}`);
    }
}

// --------------- Create Post-game Thread -----------------
export async function createPostgameThreadJob(gameId: number) {
    const logger = await Logger.Create('Jobs - Create Post-game Thread');
    
    // Check if postgame thread already exists
    const existingPgtId = await redis.get(REDIS_KEYS.GAME_TO_PGT_ID(gameId));
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
        await redis.set(REDIS_KEYS.GAME_TO_PGT_ID(gameId), post.id);
        await redis.expire(REDIS_KEYS.GAME_TO_PGT_ID(gameId), REDIS_KEYS.EXPIRY);
        await redis.set(REDIS_KEYS.PGT_TO_GAME_ID(post.id), gameId.toString());
        await redis.expire(REDIS_KEYS.PGT_TO_GAME_ID(post.id), REDIS_KEYS.EXPIRY);
        
        // Schedule cleanup for 12 hours
        await scheduleCleanup(post.id, gameId, new Date(Date.now() + UPDATE_INTERVALS.PGT_CLEANUP_DELAY));

        // Schedule update
        await scheduleNextPGTUpdate(post.id, gameId, new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT));

        // Clean up game day thread
        const existingGDT = await redis.get(REDIS_KEYS.GAME_TO_THREAD_ID(gameId));

        // Add closure comment to existingGDT
        const GDT = await reddit.getPostById(existingGDT as Post["id"]);
        const completeComment = COMMENTS.CLOSED_GDT_BASE + `${post.url.toString()}`
		await tryAddComment(GDT, completeComment)
        await tryCleanupThread(existingGDT as Post["id"]);
        
    } else {
        await sendModmail(`Post-game thread creation failed`,
`GameDayLive has detected an error creating the PGT. This is most likely due to a reddit server glitch.  
  
If this is true, please re-save your configuration to attempt posting it again.`)

        logger.error(`Failed to create post-game thread:`, result.error);
    }
}

// --------------- Next Live Update -----------------
export async function nextLiveUpdateJob(gameId: number) {
    const logger = await Logger.Create('Jobs - Next Live Update');
    
    const subredditName = context.subredditName;
    const postId = await redis.get(REDIS_KEYS.GAME_TO_THREAD_ID(gameId));
    if (!postId) {
        logger.error(`Invalid postId`);
        return;
    }

    // Check that post is actually live on reddit
    try {
        const existingPost = await reddit.getPostById(postId as Post["id"])
        if (!existingPost) {
            await tryCleanupThread(postId as Post["id"]);
        }
    } catch (err) {
        logger.error(`Failed to verify post exists: ${err instanceof Error ? err.message : String(err)}`);
        // Reschedule and try again
        const retryTime = new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT);
        logger.info(`Rescheduling update attempt for game ${gameId} at ${retryTime.toISOString()}`);
        await scheduleNextLiveUpdate(subredditName, postId, gameId, retryTime);
        return;
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
        // TODO: Set num retries in redis, stop retrying and clear after a certain amount, remember to clear redis
        const retryTime = new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT);
        logger.info(`Rescheduling update attempt for game ${gameId} at ${retryTime.toISOString()}`);
        await scheduleNextLiveUpdate(subredditName, postId, gameId, retryTime);
        return;
    }

    if (!game) {
        logger.error(`Game data is null. Game: ${gameId}`);
        // TODO: set up a retry system like above
        await scheduleNextLiveUpdate(subredditName, postId, gameId, new Date(Date.now() + (UPDATE_INTERVALS.LIVE_GAME_DEFAULT * 2)));
        return;
    }

    if (modified) {
        // Store new etag
        if (etag) {
            await redis.set(REDIS_KEYS.GAME_ETAG(gameId), etag);
            await redis.expire(REDIS_KEYS.GAME_ETAG(gameId), REDIS_KEYS.EXPIRY);
        }

        
        // Format and update thread
        const body = await formatThreadBody(game);
        const result = await tryUpdateThread(postId as Post["id"], body);
        if (!result.success) {
            logger.error(`Thread update failed for post ${postId}: ${result.error}`);

            // Reschedule another attempt in case of transient Reddit/API error
            // Set up a retry counting system
            const retryTime = new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT);
            logger.info(`Rescheduling update attempt for game ${gameId} at ${retryTime.toISOString()}`);
            await scheduleNextLiveUpdate(subredditName, postId, gameId, retryTime);
            return;
        }

    }

    // Schedule next live update
    if (game.gameState && game.gameState !== GAME_STATES.FINAL && game.gameState !== GAME_STATES.OFF) {

        // Set updateTime for now + default delay in seconds
        let updateTime: Date = new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT);

        /* NOTE: Disabled to keep intermission time remaining on thread
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
        // Schedule postgame thread only if enabled (FIX: offload method to universal location for other leagues to use)
        const config = await getSubredditConfig(context.subredditName);
        if (config?.enablePostgameThreads){
            logger.info(`Game ended. Scheduling PGT.`);
            const scheduledTime = new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT);
            await scheduleCreatePostgameThread(game, scheduledTime);
        } else {
            // PGT not enabled, cleanup game thread immediately
            await tryCleanupThread(postId as Post["id"]);
        }
    }
}

export async function nextPGTUpdateJob(gameId: number) {
    const logger = await Logger.Create('Jobs - Next PGT Update');

    try {
        // Retrieve the PGT ID from Redis
        const postId = await redis.get(REDIS_KEYS.GAME_TO_PGT_ID(gameId));
        if (!postId) {
            logger.error(`No PGT postId found for game ${gameId}`);
            return;
        }

        // Fetch game data
        const currentEtag = await redis.get(REDIS_KEYS.GAME_ETAG(gameId));
        const { game, etag, modified } = await getGameData(gameId, fetch, currentEtag);

        if (!game) {
            logger.error(`Could not fetch game data for PGT update: ${gameId}`);
            // Reschedule retry
            const retryTime = new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT);
            await scheduleNextPGTUpdate(postId as string, gameId, retryTime);
            return;
        }

        // Update the thread if the API data has changed
        if (modified) {
            if (etag) {
                await redis.set(REDIS_KEYS.GAME_ETAG(gameId), etag);
                await redis.expire(REDIS_KEYS.GAME_ETAG(gameId), REDIS_KEYS.EXPIRY);
            }

            const body = await formatThreadBody(game);
            const result = await tryUpdateThread(postId as Post["id"], body);
            
            if (!result.success) {
                logger.error(`PGT update failed for post ${postId}: ${result.error}`);
                // Reschedule retry
                const retryTime = new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT);
                logger.info(`Rescheduling PGT update for game ${gameId} at ${retryTime.toISOString()}`);
                await scheduleNextPGTUpdate(postId as string, gameId, retryTime);
                return;
            }
        }

        // Schedule next update if state is not OFF
        if (game.gameState !== GAME_STATES.OFF) {
            const nextUpdate = new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT);
            await scheduleNextPGTUpdate(postId as string, gameId, nextUpdate);
        } else {
            logger.info(`Game ${gameId} results are official. Ending PGT updates.`);
        }
        
    } catch (err) {
        logger.error(`PGT update job failed for game ${gameId}: ${err instanceof Error ? err.message : String(err)}`);
        
        // Try to reschedule
        const postId = await redis.get(REDIS_KEYS.GAME_TO_PGT_ID(gameId));
        if (postId) {
            const retryTime = new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT);
            logger.info(`Rescheduling PGT update attempt for game ${gameId} at ${retryTime.toISOString()}`);
            await scheduleNextPGTUpdate(postId as string, gameId, retryTime);
        }
    }
}

// --------------- Scheduling helpers -----------------

async function scheduleDailyGameCheck(runAt: Date) {
    const logger = await Logger.Create('Jobs - Schedule Daily Game Check');

    const job: ScheduledJob = {
        id: `daily-game-check`,
        name: JOB_NAMES.DAILY_GAME_CHECK,
        data: {}, // No data needed
        runAt: runAt,
    };

    try {
        logger.debug(`Attempting to schedule daily game check at ${runAt.toISOString()}`);

        // Check if scheduled time is in the future
        if (runAt.getTime() < Date.now()) {
            logger.warn(`Warning: scheduledTime ${runAt.toISOString()} is in the past. Job may run immediately or fail.`);
        }

        const jobId = await scheduler.runJob(job);
        
        // Optionally store jobId in Redis (not critical for daily check)
        await redis.set(REDIS_KEYS.JOB_DAILY_CHECK(), jobId);
        await redis.expire(REDIS_KEYS.JOB_DAILY_CHECK(), REDIS_KEYS.EXPIRY); // 24 hours
        
        logger.info(`Successfully scheduled daily game check job ID: ${jobId}`);

    } catch (err) {
        logger.error(`Failed to schedule daily game check: ${err instanceof Error ? err.message : String(err)}`);
    }
}

// -------- Schedule Create Game Thread --------
async function scheduleCreateGameThread(subredditName: string, game: NHLGame, scheduledTime: Date) {
    const logger = await Logger.Create('Jobs - Schedule Create Game Thread');

    const now = new Date();
    const gameId = game.id;
    const threadTitle = await formatThreadTitle(game);
    const shortTitle = `${game.awayTeam.abbrev}@${game.homeTeam.abbrev}`;
    const jobTitle = `GDT-${shortTitle}-${game.id}`;

    const staleGameAge = UPDATE_INTERVALS.LATE_SCHEDULE_THRESHOLD;

    if (scheduledTime < now) {
        const ageMs = now.getTime() - new Date(game.startTimeUTC).getTime();

        // Scheduled start is in the past, but not stale
        if (ageMs <= staleGameAge) {
            scheduledTime = now;
        } else {
            // Game started 3+ hours ago - check if it's actually finished
            logger.warn(`Game started ${Math.round(ageMs / 1000 / 60)} minutes ago (threshold: ${staleGameAge / 1000 / 60} min). State: ${game.gameState}`);
            
            if (game.gameState === GAME_STATES.FINAL || game.gameState === GAME_STATES.OFF) {
                logger.info(`Game is finished. Trying PGT instead.`);
                await scheduleCreatePostgameThread(game, now);
                return;
            } else {
                logger.info(`Game not finished. Creating game thread now.`);
                scheduledTime = now;
            }
        }
    }

    // only schedule if no same job exists
    const existingJobId = await redis.get(REDIS_KEYS.JOB_CREATE(gameId));
    const existingJob = existingJobId ? await getJobData(existingJobId) : undefined;

    if (existingJob?.data?.jobTitle === jobTitle) {
        logger.warn(`Job ${jobTitle} already exists. Skipping scheduling.`);
        return;
    }

    /* Thread title check disabled due to nonfunctioning reddit.getNewPosts()
    const foundThread = await findRecentThreadByName(threadTitle);
    if (foundThread){
        logger.warn(`Game day thread matching title ${threadTitle} already exists. Skipping scheduling.`);
        return;
    }
    */

    const jobData: NewJobData = { subredditName, gameId, jobTitle, threadTitle }
    const job: ScheduledJob = {
        id: `create-thread-${gameId}`,
        name: JOB_NAMES.CREATE_GAME_THREAD,
        data: jobData,
        runAt: scheduledTime,
    };

    logger.debug(`Job data: ${JSON.stringify(jobData)}`);

    try {
        logger.debug(`Attempting to schedule job ${jobTitle} at ${scheduledTime.toISOString()}`);

        const jobId = await scheduler.runJob(job);
        // Store jobId in Redis
        await redis.set(REDIS_KEYS.JOB_CREATE(gameId), jobId);
        await redis.expire(REDIS_KEYS.JOB_CREATE(gameId), REDIS_KEYS.EXPIRY);
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
    const shortTitle = `${game.awayTeam.abbrev}@${game.homeTeam.abbrev}`;
    const jobTitle = `PGT-${shortTitle}-${gameId}`;

    // Only schedule if enabled in subredditConfig
    const config: SubredditConfig | undefined = await getSubredditConfig(subredditName);
    if (!config) {
        // Should never happen, but if so, send mod mail?
    }
    if (!config?.enablePostgameThreads) {
        logger.info(`Post-game threads disabled in subreddit ${subredditName}`);

        // Clean up GDT accordingly.
        const GDTId = await redis.get(REDIS_KEYS.GAME_TO_THREAD_ID(gameId));
        if (GDTId) {
            await tryCleanupThread(GDTId as Post["id"]);
        }

        return;
    }

    // Only schedule if no same scheduled job exists
    const existingJobId = await redis.get(REDIS_KEYS.JOB_POSTGAME(gameId));
    const existingJob = existingJobId ? await getJobData(existingJobId) : undefined;

    if (existingJob?.data?.jobTitle === jobTitle) {
        logger.warn(`Job ${jobTitle} already exists. Skipping scheduling.`);
        return;
    }

    // Only schedule if no same THREAD exists
    /* Thread title check disabled due to nonfunctioning reddit.getNewPosts()
    const foundThread = await findRecentThreadByName(threadTitle);
    if (foundThread){
        logger.warn(`Postgame thread matching title ${threadTitle} already exists. Skipping scheduling.`);
        return;
    }
    */
   
    const jobData: NewJobData = { subredditName, gameId, jobTitle, threadTitle }
    const job: ScheduledJob = {
        id: `create-postgame-${gameId}`,
        name: JOB_NAMES.CREATE_POSTGAME_THREAD,
        data: jobData,
        runAt: scheduledTime,
    };

    logger.debug(`Job data: ${JSON.stringify(jobData)}`);

    try {
        logger.debug(`Attempting to schedule job: ${jobTitle} at ${scheduledTime.toISOString()}`);

        const jobId = await scheduler.runJob(job);
        // Store jobId in Redis
        await redis.set(REDIS_KEYS.JOB_POSTGAME(gameId), jobId);
        await redis.expire(REDIS_KEYS.JOB_POSTGAME(gameId), REDIS_KEYS.EXPIRY);

        logger.info(`Successfully scheduled job ID: ${jobId} | title: ${jobTitle}`);
    } catch (err) {
        logger.error(`Failed to schedule job ${jobTitle}: ${err instanceof Error ? err.message : String(err)}`);
    }
}

// -------- Schedule Next Live Update --------
async function scheduleNextLiveUpdate(subredditName: string, postId: string, gameId: number, updateTime: Date) {
    const logger = await Logger.Create('Jobs - Schedule Live Update');

    const jobTitle = `Thread-Update-${postId}`;

    const jobData: UpdateJobData = { subredditName, gameId, postId, jobTitle }

    const job: ScheduledJob = {
        id: `Thread-update-${postId}`,
        name: JOB_NAMES.NEXT_LIVE_UPDATE,
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
        await redis.set(REDIS_KEYS.JOB_GDT_UPDATE(gameId), jobId);
        await redis.expire(REDIS_KEYS.JOB_GDT_UPDATE(gameId), REDIS_KEYS.EXPIRY);
        logger.info(`Successfully scheduled job ID: ${jobId} | title: ${jobTitle}`);

    } catch (err) {
        logger.error(`Failed to schedule ${jobTitle}: ${err instanceof Error ? err.message : String(err)}`);
    }
}

async function scheduleNextPGTUpdate(postId: string, gameId: number, updateTime: Date) {
    const logger = await Logger.Create('Jobs - Schedule PGT Update');

    const subredditName = context.subredditName;
    const jobTitle = `PGT-Update-${postId}`;

    const jobData: UpdateJobData = { subredditName, gameId, postId, jobTitle }

    const job: ScheduledJob = {
        id: `PGT-update-${postId}`,
        name: JOB_NAMES.NEXT_PGT_UPDATE,
        data: jobData,
        runAt: updateTime,
    };

    try {
        const jobId = await scheduler.runJob(job);

        await redis.set(REDIS_KEYS.JOB_PGT_UPDATE(gameId), jobId);
        await redis.expire(REDIS_KEYS.JOB_PGT_UPDATE(gameId), REDIS_KEYS.EXPIRY);
        logger.info(`Scheduled PGT update ID: ${jobId} for game ${gameId}`);
    } catch (err) {
        logger.error(`Failed to schedule PGT update: ${err instanceof Error ? err.message : String(err)}`);
    }
}

async function scheduleCleanup(postId: Post["id"], gameId: number, cleanupTime: Date){
    const logger = await Logger.Create(`Jobs - Schedule Cleanup`);

    const subredditName = context.subredditName;
    const jobTitle = `PGT-Cleanup-${postId}`;
    const jobData: CleanupJobData = { subredditName, gameId, postId, jobTitle};

    const job: ScheduledJob = {
        id: `PGT-cleanup-${postId}`,
        name: JOB_NAMES.PGT_CLEANUP,
        data: jobData,
        runAt: cleanupTime
    }

    try {
        const jobId = await scheduler.runJob(job);

        await redis.set(REDIS_KEYS.JOB_PGT_CLEANUP(gameId), jobId);
        await redis.expire(REDIS_KEYS.JOB_PGT_CLEANUP(gameId), REDIS_KEYS.EXPIRY * 2);
        logger.info(`Scheduled PGT cleanup ID: ${jobId} for game ${gameId}`);
    } catch (err) {
        logger.error(`Failed to schedule PGT cleanup: ${err instanceof Error ? err.message : String(err)}`);
    }
}