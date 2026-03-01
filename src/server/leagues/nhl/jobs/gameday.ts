import { redis, context, scheduler, ScheduledJob, Post, reddit } from '@devvit/web/server';
import { getGameData, NHLGame } from '../api';
import { formatThreadTitle, formatThreadBody } from '../formatting/formatter';
import { UPDATE_INTERVALS, GAME_STATES, REDIS_KEYS, JOB_NAMES } from '../constants';
import { getSubredditConfig } from '../../../config';
import { tryCleanupThread, tryCreateThread, tryUpdateThread } from '../../../threads';
import { NewJobData, UpdateJobData } from '../../../types';
import { Logger } from '../../../utils/Logger';
import { getJobData } from '../../../utils/jobs';
import { sendModmail } from '../../../modmail';
import { scheduleDailyGameCheck } from './dailyGameCheck';
import { scheduleCreatePostgameThread } from './postgame';

// --------------- Create Game Thread -----------------
export async function createGameThreadJob(gameId: number) {
    const logger = await Logger.Create('Jobs - Create Game Thread');
    
    const subredditName = context.subredditName;
    const config = await getSubredditConfig(subredditName);
    if (!config) {
        logger.error(`No config found for ${subredditName}, aborting.`);
        await sendModmail(
            `Failed to post thread`,
            `A configuration error prevented GameDayLive from posting a thread. Please re-save your configuration from the subreddit menu.`
        );
        return;
    }

    const attemptKey = REDIS_KEYS.CREATE_THREAD_ATTEMPTS(gameId);
    const attemptNumber = parseInt(await redis.get(attemptKey) || '0');

    logger.debug(`Fetching data for game ${gameId} (attempt ${attemptNumber + 1})`);

    let game: NHLGame;
    try {
        const result = await getGameData(gameId, fetch);
        game = result.game;
    } catch (err) {
        logger.error(`Failed to fetch game data: ${err instanceof Error ? err.message : String(err)}`);
        
        if (attemptNumber < 5) {
            const backoffMs = Math.min(60000 * Math.pow(2, attemptNumber), UPDATE_INTERVALS.RETRY_MAX_TIME);
            const retryTime = new Date(Date.now() + backoffMs);
            
            await redis.set(attemptKey, String(attemptNumber + 1));
            await redis.expire(attemptKey, 7200);
            
            logger.info(`Rescheduling daily game check at ${retryTime.toISOString()}`);
            await scheduleDailyGameCheck(retryTime);
        } else {
            logger.error(`Failed to fetch game data after ${attemptNumber + 1} attempts. Giving up on game ${gameId}.`);
            await sendModmail(
                `Failed to Post GDT!`,
                `GameDayLive made ${attemptNumber + 1} attempts to retrieve the data for game ${gameId}, but was unsuccessful. The NHL API may be down or blocking GameDayLive. You can re-save your configuration to try again.`
            );
            await redis.del(attemptKey);
        }
        return;
    }
    // Clear attempt counter
    await redis.del(attemptKey);
    
    // Ensure no existing thread for game
    try {
        const existingThreadId = await redis.get(REDIS_KEYS.GAME_TO_THREAD_ID(gameId));
        if (existingThreadId) {
            logger.debug(`Found redis lock for game ${gameId}`);
            
            const foundPost = await reddit.getPostById(existingThreadId as Post["id"]);
            if (!foundPost) {
                logger.warn(`Thread ${existingThreadId} in Redis but not on Reddit. Cleaning up.`);
                await tryCleanupThread(existingThreadId as Post["id"], config.gameday.lock);
            } else {
                const deleted = foundPost.isRemoved();
                if (deleted) {
                    logger.info(`Gameday thread ID: ${existingThreadId} was deleted. Cleaning up.`);
                    await tryCleanupThread(existingThreadId as Post["id"], config.gameday.lock);
                } else {
                    logger.info(`Gameday thread already exists (ID: ${existingThreadId}) for game ${gameId}. Skipping creation.`); 
                }

                const gameIsOver = game.gameState === GAME_STATES.FINAL || game.gameState === GAME_STATES.OFF; 
                if (gameIsOver) {
                    logger.debug(`Tried to create thread for game that's over.`);
                    await tryCleanupThread(existingThreadId as Post["id"], config.gameday.lock);
                    
                    const existingPostgameThreadId = await redis.get(REDIS_KEYS.GAME_TO_PGT_ID(gameId));
                    logger.debug(`Checking for Post-game thread...`);
                    if (existingPostgameThreadId) {
                        logger.debug(`PGT found, cleaning up Redis...`);
                        await tryCleanupThread(existingPostgameThreadId as Post["id"], config.postgame.lock);
                    } else {
                        logger.debug(`No PGT found, scheduling new.`);
                        await scheduleCreatePostgameThread(game, new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT));
                    }
                    return;
                }

                const jobs = await scheduler.listJobs();
                const thisGameJobs = jobs.filter(job => 
                    job.data?.gameId === gameId && 
                    job.name === JOB_NAMES.NEXT_LIVE_UPDATE,
                );

                if (thisGameJobs.length > 0) {
                    logger.info(`Live update job already scheduled for game ${gameId}`);
                    return;
                }

                const updateTime = new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT);
                await scheduleNextLiveUpdate(subredditName, existingThreadId as Post["id"], game.id, updateTime);
                return;
            }
        }

    } catch (err) {
        logger.error(`Error checking existing thread. Proceeding with creation - duplicate may occur.`, err);
    }

    // Format title & body
    const title = await formatThreadTitle(game);
    const body = await formatThreadBody(game);

    // Create thread on reddit
    const result = await tryCreateThread(context, title, body, config.gameday.sticky, config.gameday.sort);

    if (result.success) {
        const post = result.post!;
        logger.info(`Created post ID: ${post.id}`);

        await redis.set(REDIS_KEYS.GAME_TO_THREAD_ID(gameId), post.id);
        await redis.expire(REDIS_KEYS.GAME_TO_THREAD_ID(gameId), REDIS_KEYS.EXPIRY);
        await redis.set(REDIS_KEYS.THREAD_TO_GAME_ID(post.id), gameId.toString());
        await redis.expire(REDIS_KEYS.THREAD_TO_GAME_ID(post.id), REDIS_KEYS.EXPIRY);

        if (!game.gameState || game.gameState !== GAME_STATES.FINAL && game.gameState !== GAME_STATES.OFF) {
            let updateTime = new Date(game.startTimeUTC);

            if (game.gameState == GAME_STATES.LIVE || game.gameState == GAME_STATES.CRIT) {
                updateTime = new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT);
            }

            await scheduleNextLiveUpdate(subredditName, post.id, game.id, updateTime);
        }
    } else {
        await sendModmail(
            `Game day thread creation failed`,
            `GameDayLive has detected an error creating the game day thread. This is most likely due to a reddit server glitch.  \n  \nIf this is true, please re-save your configuration to attempt posting it again.`
        );
        logger.error(`Failed to create post: ${result.error}`);
    }
}

// --------------- Next Live Update (GDT) -----------------
export async function nextLiveUpdateJob(gameId: number) {
    const logger = await Logger.Create('Jobs - Next Live Update');
    
    const subredditName = context.subredditName;
    const config = await getSubredditConfig(subredditName);
    if (!config) {
        logger.error(`No config found for ${subredditName}, aborting.`);
        return;
    }
    
    const postId = await redis.get(REDIS_KEYS.GAME_TO_THREAD_ID(gameId));
    if (!postId) {
        logger.error(`Invalid postId`);
        return;
    }

    // Check that post is actually live on reddit
    try {
        const existingPost = await reddit.getPostById(postId as Post["id"]);
        if (!existingPost) {
            await tryCleanupThread(postId as Post["id"], config.gameday.lock);
        }
    } catch (err) {
        logger.error(`Failed to verify post exists: ${err instanceof Error ? err.message : String(err)}`);
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
        
        const retryTime = new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT);
        logger.info(`Rescheduling update attempt for game ${gameId} at ${retryTime.toISOString()}`);
        await scheduleNextLiveUpdate(subredditName, postId, gameId, retryTime);
        return;
    }

    if (!game) {
        logger.error(`Game data is null. Game: ${gameId}`);
        await scheduleNextLiveUpdate(subredditName, postId, gameId, new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT * 2));
        return;
    }

    if (modified) {
        if (etag) {
            await redis.set(REDIS_KEYS.GAME_ETAG(gameId), etag);
            await redis.expire(REDIS_KEYS.GAME_ETAG(gameId), REDIS_KEYS.EXPIRY);
        }

        const body = await formatThreadBody(game);
        const result = await tryUpdateThread(postId as Post["id"], body);
        if (!result.success) {
            logger.error(`Thread update failed for post ${postId}: ${result.error}`);
            const retryTime = new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT);
            logger.info(`Rescheduling update attempt for game ${gameId} at ${retryTime.toISOString()}`);
            await scheduleNextLiveUpdate(subredditName, postId, gameId, retryTime);
            return;
        }
    }

    // Schedule next live update
    if (game.gameState && game.gameState !== GAME_STATES.FINAL && game.gameState !== GAME_STATES.OFF) {
        let updateTime: Date = new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT);

        /* NOTE: Disabled to keep intermission time remaining on thread
        if (game.clock?.inIntermission) {
            const intermissionRemaining = game.clock.secondsRemaining;
            if (intermissionRemaining > (UPDATE_INTERVALS.INTERMISSION / 1000)) {
                logger.debug(`Game is in intermission`);
                updateTime = new Date(Date.now() + ((intermissionRemaining * 1000)-UPDATE_INTERVALS.INTERMISSION));
            }
        }
        */

        if (game.periodDescriptor?.periodType == "OT" || game.periodDescriptor?.periodType == "SO") {
            updateTime = new Date(Date.now() + UPDATE_INTERVALS.OVERTIME_SHOOTOUT);
        } 

        await scheduleNextLiveUpdate(subredditName, postId, gameId, updateTime);

    } else {
        // Game finished
        if (config?.postgame.enabled) {
            logger.info(`Game ended. Scheduling PGT.`);
            const scheduledTime = new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT);
            await scheduleCreatePostgameThread(game, scheduledTime);
        } else {
            await tryCleanupThread(postId as Post["id"], config.gameday.lock);
        }
    }
}

// --------------- Schedule Create Game Thread -----------------
export async function scheduleCreateGameThread(subredditName: string, game: NHLGame, scheduledTime: Date) {
    const logger = await Logger.Create('Jobs - Schedule Create Game Thread');

    const now = new Date();
    const gameId = game.id;
    const threadTitle = await formatThreadTitle(game);
    const shortTitle = `${game.awayTeam.abbrev}@${game.homeTeam.abbrev}`;
    const jobTitle = `GDT-${shortTitle}-${game.id}`;
    const staleGameAge = UPDATE_INTERVALS.LATE_SCHEDULE_THRESHOLD;

    if (scheduledTime < now) {
        const ageMs = now.getTime() - new Date(game.startTimeUTC).getTime();

        if (ageMs <= staleGameAge) {
            scheduledTime = now;
        } else {
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

    const existingJobId = await redis.get(REDIS_KEYS.JOB_CREATE(gameId));
    const existingJob = existingJobId ? await getJobData(existingJobId) : undefined;

    if (existingJob?.data?.jobTitle === jobTitle) {
        logger.warn(`Job ${jobTitle} already exists. Skipping scheduling.`);
        return;
    }

    /* NOTE: Thread title check disabled due to nonfunctioning reddit.getNewPosts()
    const foundThread = await findRecentThreadByName(threadTitle);
    if (foundThread){
        logger.warn(`Game day thread matching title ${threadTitle} already exists. Skipping scheduling.`);
        return;
    }
    */

    const jobData: NewJobData = { subredditName, gameId, jobTitle, threadTitle };
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
        await redis.set(REDIS_KEYS.JOB_CREATE(gameId), jobId);
        await redis.expire(REDIS_KEYS.JOB_CREATE(gameId), REDIS_KEYS.EXPIRY);
        logger.info(`Successfully scheduled job ID: ${jobId} | title: ${jobTitle}`);
        logger.debug(`time: ${scheduledTime.toISOString()} | now: ${new Date(Date.now()).toISOString()}`);

    } catch (err) {
        logger.error(`Failed to schedule ${jobTitle}: ${err instanceof Error ? err.message : String(err)}`);
    }
}

// --------------- Schedule Next Live Update -----------------
export async function scheduleNextLiveUpdate(subredditName: string, postId: string, gameId: number, updateTime: Date) {
    const logger = await Logger.Create('Jobs - Schedule Live Update');

    const jobTitle = `Thread-Update-${postId}`;
    const jobData: UpdateJobData = { subredditName, gameId, postId, jobTitle };

    const job: ScheduledJob = {
        id: `Thread-update-${postId}`,
        name: JOB_NAMES.NEXT_LIVE_UPDATE,
        data: jobData,
        runAt: updateTime,
    };

    logger.debug(`Job data: ${JSON.stringify(jobData)}`);

    try {
        logger.debug(`Attempting to schedule update: ${jobTitle} at ${updateTime.toISOString()}`);

        if (updateTime.getTime() < Date.now()) {
            logger.warn(`Warning: scheduledTime ${updateTime.toISOString()} is in the past. Job may run immediately or fail.`);
        }

        const jobId = await scheduler.runJob(job);
        await redis.set(REDIS_KEYS.JOB_GDT_UPDATE(gameId), jobId);
        await redis.expire(REDIS_KEYS.JOB_GDT_UPDATE(gameId), REDIS_KEYS.EXPIRY);
        logger.info(`Successfully scheduled job ID: ${jobId} | title: ${jobTitle}`);

    } catch (err) {
        logger.error(`Failed to schedule ${jobTitle}: ${err instanceof Error ? err.message : String(err)}`);
    }
}