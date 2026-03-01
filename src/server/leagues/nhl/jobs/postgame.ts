import { redis, context, scheduler, ScheduledJob, Post, reddit } from '@devvit/web/server';
import { getGameData, NHLGame } from '../api';
import { formatThreadTitle, formatThreadBody } from '../formatting/formatter';
import { UPDATE_INTERVALS, GAME_STATES, REDIS_KEYS, JOB_NAMES, COMMENTS } from '../constants';
import { getSubredditConfig } from '../../../config';
import { tryCleanupThread, tryCreateThread, tryUpdateThread, tryAddComment } from '../../../threads';
import { NewJobData, UpdateJobData, CleanupJobData } from '../../../types';
import { Logger } from '../../../utils/Logger';
import { getJobData } from '../../../utils/jobs';
import { sendModmail } from '../../../modmail';
import { scheduleDailyGameCheck } from './dailyGameCheck';

// --------------- Create Post-game Thread -----------------
export async function createPostgameThreadJob(gameId: number) {
    const logger = await Logger.Create('Jobs - Create Post-game Thread');

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
    
    // Check if postgame thread already exists
    const existingPgtId = await redis.get(REDIS_KEYS.GAME_TO_PGT_ID(gameId));
    if (existingPgtId) {
        logger.info(`Postgame thread already exists (ID: ${existingPgtId}) for game ${gameId}. Skipping.`);
        return;
    }

    const attemptKey = REDIS_KEYS.CREATE_PGT_ATTEMPTS(gameId);
    const attemptNumber = parseInt(await redis.get(attemptKey) || '0');

    logger.debug(`Fetching data for PGT game: ${gameId} (attempt ${attemptNumber + 1})`);

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
                `Failed to Post PGT!`,
                `GameDayLive made ${attemptNumber + 1} attempts to retrieve the data for game ${gameId}, but was unsuccessful. The NHL API may be down or blocking GameDayLive. You can re-save your configuration to try again.`
            );
            await redis.del(attemptKey);
        }
        return;
    }

    const title = await formatThreadTitle(game);
    const body = await formatThreadBody(game);

    const result = await tryCreateThread(context, title, body, config.postgame.sticky, config.postgame.sort);

    if (result.success) {
        const post = result.post!;
        logger.info(`Created Post-game ID: ${post.id}`);

        await redis.set(REDIS_KEYS.GAME_TO_PGT_ID(gameId), post.id);
        await redis.expire(REDIS_KEYS.GAME_TO_PGT_ID(gameId), REDIS_KEYS.EXPIRY);
        await redis.set(REDIS_KEYS.PGT_TO_GAME_ID(post.id), gameId.toString());
        await redis.expire(REDIS_KEYS.PGT_TO_GAME_ID(post.id), REDIS_KEYS.EXPIRY);
        
        await scheduleCleanup(post.id, gameId, new Date(Date.now() + UPDATE_INTERVALS.PGT_CLEANUP_DELAY));
        await scheduleNextPGTUpdate(post.id, gameId, new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT));

        // Clean up game day thread
        const existingGDT = await redis.get(REDIS_KEYS.GAME_TO_THREAD_ID(gameId));
        const GDT = await reddit.getPostById(existingGDT as Post["id"]);
        const completeComment = COMMENTS.CLOSED_GDT_BASE + `${post.url.toString()}`;
        if (config.gameday.lock) {
            await tryAddComment(GDT, completeComment);
        }
        await tryCleanupThread(existingGDT as Post["id"], config.gameday.lock);
        
    } else {
        await sendModmail(
            `Post-game thread creation failed`,
            `GameDayLive has detected an error creating the PGT. This is most likely due to a reddit server glitch.  \n  \nIf this is true, please re-save your configuration to attempt posting it again.`
        );
        logger.error(`Failed to create post-game thread:`, result.error);
    }
}

// --------------- Next PGT Update -----------------
export async function nextPGTUpdateJob(gameId: number) {
    const logger = await Logger.Create('Jobs - Next PGT Update');

    try {
        const postId = await redis.get(REDIS_KEYS.GAME_TO_PGT_ID(gameId));
        if (!postId) {
            logger.error(`No PGT postId found for game ${gameId}`);
            return;
        }

        const currentEtag = await redis.get(REDIS_KEYS.GAME_ETAG(gameId));
        const { game, etag, modified } = await getGameData(gameId, fetch, currentEtag);

        if (!game) {
            logger.error(`Could not fetch game data for PGT update: ${gameId}`);
            const retryTime = new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT);
            await scheduleNextPGTUpdate(postId as string, gameId, retryTime);
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
                logger.error(`PGT update failed for post ${postId}: ${result.error}`);
                const retryTime = new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT);
                logger.info(`Rescheduling PGT update for game ${gameId} at ${retryTime.toISOString()}`);
                await scheduleNextPGTUpdate(postId as string, gameId, retryTime);
                return;
            }
        }

        if (game.gameState !== GAME_STATES.OFF) {
            const nextUpdate = new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT);
            await scheduleNextPGTUpdate(postId as string, gameId, nextUpdate);
        } else {
            logger.info(`Game ${gameId} results are official. Ending PGT updates.`);
        }
        
    } catch (err) {
        logger.error(`PGT update job failed for game ${gameId}: ${err instanceof Error ? err.message : String(err)}`);
        
        const postId = await redis.get(REDIS_KEYS.GAME_TO_PGT_ID(gameId));
        if (postId) {
            const retryTime = new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT);
            logger.info(`Rescheduling PGT update attempt for game ${gameId} at ${retryTime.toISOString()}`);
            await scheduleNextPGTUpdate(postId as string, gameId, retryTime);
        }
    }
}

// --------------- Schedule Create Postgame Thread -----------------
export async function scheduleCreatePostgameThread(game: NHLGame, scheduledTime: Date) {
    const logger = await Logger.Create('Jobs - Schedule Create Post-game Thread');

    const gameId = game.id;
    const subredditName = context.subredditName;
    const threadTitle = await formatThreadTitle(game);
    const shortTitle = `${game.awayTeam.abbrev}@${game.homeTeam.abbrev}`;
    const jobTitle = `PGT-${shortTitle}-${gameId}`;

    const config = await getSubredditConfig(subredditName);
    if (!config) {
        logger.error(`No config found for ${subredditName}, aborting.`);
        await sendModmail(
            `Failed to post thread`,
            `A configuration error prevented GameDayLive from posting a thread. Please re-save your configuration from the subreddit menu.`
        );
        return;
    }

    if (!config?.postgame.enabled) {
        logger.info(`Post-game threads disabled in subreddit ${subredditName}`);

        const GDTId = await redis.get(REDIS_KEYS.GAME_TO_THREAD_ID(gameId));
        if (GDTId) {
            await tryCleanupThread(GDTId as Post["id"], config.gameday.lock);
        }
        return;
    }

    const existingJobId = await redis.get(REDIS_KEYS.JOB_POSTGAME(gameId));
    const existingJob = existingJobId ? await getJobData(existingJobId) : undefined;

    if (existingJob?.data?.jobTitle === jobTitle) {
        logger.warn(`Job ${jobTitle} already exists. Skipping scheduling.`);
        return;
    }

    /* NOTE: Thread title check disabled due to nonfunctioning reddit.getNewPosts()
    const foundThread = await findRecentThreadByName(threadTitle);
    if (foundThread){
        logger.warn(`Postgame thread matching title ${threadTitle} already exists. Skipping scheduling.`);
        return;
    }
    */

    const jobData: NewJobData = { subredditName, gameId, jobTitle, threadTitle };
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
        await redis.set(REDIS_KEYS.JOB_POSTGAME(gameId), jobId);
        await redis.expire(REDIS_KEYS.JOB_POSTGAME(gameId), REDIS_KEYS.EXPIRY);
        logger.info(`Successfully scheduled job ID: ${jobId} | title: ${jobTitle}`);

    } catch (err) {
        logger.error(`Failed to schedule job ${jobTitle}: ${err instanceof Error ? err.message : String(err)}`);
    }
}

// --------------- Schedule Next PGT Update -----------------
async function scheduleNextPGTUpdate(postId: string, gameId: number, updateTime: Date) {
    const logger = await Logger.Create('Jobs - Schedule PGT Update');

    const subredditName = context.subredditName;
    const jobTitle = `PGT-Update-${postId}`;
    const jobData: UpdateJobData = { subredditName, gameId, postId, jobTitle };

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

// --------------- Schedule Cleanup -----------------
async function scheduleCleanup(postId: Post["id"], gameId: number, cleanupTime: Date) {
    const logger = await Logger.Create(`Jobs - Schedule Cleanup`);

    const subredditName = context.subredditName;
    const jobTitle = `PGT-Cleanup-${postId}`;
    const jobData: CleanupJobData = { subredditName, gameId, postId, jobTitle };

    const job: ScheduledJob = {
        id: `PGT-cleanup-${postId}`,
        name: JOB_NAMES.PGT_CLEANUP,
        data: jobData,
        runAt: cleanupTime,
    };

    try {
        const jobId = await scheduler.runJob(job);
        await redis.set(REDIS_KEYS.JOB_PGT_CLEANUP(gameId), jobId);
        await redis.expire(REDIS_KEYS.JOB_PGT_CLEANUP(gameId), REDIS_KEYS.EXPIRY * 2);
        logger.info(`Scheduled PGT cleanup ID: ${jobId} for game ${gameId}`);
    } catch (err) {
        logger.error(`Failed to schedule PGT cleanup: ${err instanceof Error ? err.message : String(err)}`);
    }
}