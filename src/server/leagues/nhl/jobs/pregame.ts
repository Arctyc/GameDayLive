import { redis, context, scheduler, ScheduledJob, Post } from '@devvit/web/server';
import { getGameData, getPregameData, NHLGame } from '../api';
import { formatPregameTitle, formatPregameBody } from '../formatting/formatPregame';
import { UPDATE_INTERVALS, REDIS_KEYS, JOB_NAMES } from '../constants';
import { getSubredditConfig } from '../../../config';
import { tryCreateThread } from '../../../threads';
import { NewJobData, CleanupJobData } from '../../../types';
import { Logger } from '../../../utils/Logger';
import { getJobData } from '../../../utils/jobs';
import { sendModmail } from '../../../modmail';

// --------------- Create Pregame Thread -----------------
export async function createPregameThreadJob(gameId: number) {
    const logger = await Logger.Create('Jobs - Create Pre-game Thread');

    const subredditName = context.subredditName;
    const config = await getSubredditConfig(subredditName);
    if (!config) {
        logger.error(`No config found for ${subredditName}, aborting.`);
        await sendModmail(
            `Failed to post thread`,
            `A configuration error prevented GameDayLive from posting a pre-game thread. Please re-save your configuration from the subreddit menu.`
        );
        return;
    }

    if (!config.pregame.enabled) {
        logger.info(`Pre-game threads disabled for ${subredditName}. Skipping.`);
        return;
    }

    // Check if pregame thread already exists
    const existingId = await redis.get(REDIS_KEYS.GAME_TO_PREGAME_ID(gameId));
    if (existingId) {
        logger.info(`Pre-game thread already exists (ID: ${existingId}) for game ${gameId}. Skipping.`);
        return;
    }

    logger.debug(`Fetching data for pre-game thread: game ${gameId}`);

    let game: NHLGame;
    try {
        const result = await getGameData(gameId, fetch);
        game = result.game;
    } catch (err) {
        logger.error(`Failed to fetch game data: ${err instanceof Error ? err.message : String(err)}`);
        await sendModmail(
            `Failed to Post Pre-game Thread`,
            `GameDayLive was unable to retrieve game data for game ${gameId} when creating the pre-game thread.`
        );
        return;
    }

    // Fetch all pregame data (standings, stats, season series, etc.)
    let pregameData;
    try {
        pregameData = await getPregameData(game, fetch);
    } catch (err) {
        logger.error(`Failed to fetch pregame data: ${err instanceof Error ? err.message : String(err)}`);
        // Continue with empty data — the formatter handles missing sections gracefully
        pregameData = {
            skaterLeaders: [],
            seasonSeries: [],
        };
    }

    const title = await formatPregameTitle(game);
    const body = await formatPregameBody(game, pregameData);

    const result = await tryCreateThread(context, title, body, config.pregame.sticky, config.pregame.sort);

    if (result.success) {
        const post = result.post!;
        logger.info(`Created Pre-game thread ID: ${post.id}`);

        await redis.set(REDIS_KEYS.GAME_TO_PREGAME_ID(gameId), post.id);
        await redis.expire(REDIS_KEYS.GAME_TO_PREGAME_ID(gameId), REDIS_KEYS.EXPIRY);
        await redis.set(REDIS_KEYS.PREGAME_TO_GAME_ID(post.id), gameId.toString());
        await redis.expire(REDIS_KEYS.PREGAME_TO_GAME_ID(post.id), REDIS_KEYS.EXPIRY);

        // Schedule cleanup for 1 hour before game start — when the GDT goes live
        const cleanupTime = new Date(new Date(game.startTimeUTC).getTime() - UPDATE_INTERVALS.PREGAME_THREAD_OFFSET);
        await schedulePregameCleanup(post.id, gameId, cleanupTime);
    } else {
        logger.error(`Failed to create pre-game thread: ${result.error}`);
        await sendModmail(
            `Pre-game thread creation failed`,
            `GameDayLive encountered an error creating the pre-game thread for game ${gameId}. This is most likely a Reddit server issue.`
        );
    }
}

// --------------- Schedule Pregame Cleanup -----------------
async function schedulePregameCleanup(postId: Post["id"], gameId: number, cleanupTime: Date) {
    const logger = await Logger.Create(`Jobs - Schedule Pregame Cleanup`);

    const subredditName = context.subredditName;
    const jobTitle = `Pregame-Cleanup-${postId}`;
    const jobData: CleanupJobData = { subredditName, gameId, postId, jobTitle };

    const job: ScheduledJob = {
        id: `pregame-cleanup-${postId}`,
        name: JOB_NAMES.PREGAME_CLEANUP,
        data: jobData,
        runAt: cleanupTime,
    };

    try {
        const jobId = await scheduler.runJob(job);
        await redis.set(REDIS_KEYS.JOB_PREGAME_CLEANUP(gameId), jobId);
        await redis.expire(REDIS_KEYS.JOB_PREGAME_CLEANUP(gameId), REDIS_KEYS.EXPIRY);
        logger.info(`Scheduled pregame cleanup ID: ${jobId} for game ${gameId} at ${cleanupTime.toISOString()}`);
    } catch (err) {
        logger.error(`Failed to schedule pregame cleanup: ${err instanceof Error ? err.message : String(err)}`);
    }
}

// --------------- Schedule Pregame Thread -----------------
export async function schedulePregameThread(game: NHLGame, scheduledTime: Date) {
    const logger = await Logger.Create('Jobs - Schedule Pre-game Thread');

    const gameId = game.id;
    const subredditName = context.subredditName;
    const threadTitle = await formatPregameTitle(game);
    const shortTitle = `${game.awayTeam.abbrev}@${game.homeTeam.abbrev}`;
    const jobTitle = `PGT-Pre-${shortTitle}-${gameId}`;

    // Deduplicate
    const existingJobId = await redis.get(REDIS_KEYS.JOB_PREGAME(gameId));
    const existingJob = existingJobId ? await getJobData(existingJobId) : undefined;
    if (existingJob?.data?.jobTitle === jobTitle) {
        logger.warn(`Pre-game job ${jobTitle} already exists. Skipping.`);
        return;
    }

    const jobData: NewJobData = { subredditName, gameId, jobTitle, threadTitle };
    const job: ScheduledJob = {
        id: `create-pregame-${gameId}`,
        name: JOB_NAMES.CREATE_PREGAME_THREAD,
        data: jobData,
        runAt: scheduledTime,
    };

    try {
        const jobId = await scheduler.runJob(job);
        await redis.set(REDIS_KEYS.JOB_PREGAME(gameId), jobId);
        await redis.expire(REDIS_KEYS.JOB_PREGAME(gameId), REDIS_KEYS.EXPIRY);
        logger.info(`Successfully scheduled pre-game job ID: ${jobId} | title: ${jobTitle}`);
    } catch (err) {
        logger.error(`Failed to schedule pre-game job: ${err instanceof Error ? err.message : String(err)}`);
    }
}