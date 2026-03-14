import { redis, context, scheduler, ScheduledJob, Post, reddit } from '@devvit/web/server';
import { getGameData, getRightRailData, getThreeStars, Officials, ThreeStar, NHLGame } from '../api';
import { formatThreadTitle, formatThreadBody } from '../formatting/formatter';
import { UPDATE_INTERVALS, GAME_STATES, REDIS_KEYS, JOB_NAMES } from '../constants';
import { getSubredditConfig } from '../../../config';
import { tryCleanupThread, tryCreateThread, tryUpdateThread, tryCancelScheduledJob } from '../../../threads';
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

    if (!config.gameday.enabled) {
        logger.info(`Game day threads disabled for ${subredditName}. Skipping.`);
        return;
    }

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
        await redis.set(REDIS_KEYS.GAME_STATE(gameId), game.gameState);
        await redis.expire(REDIS_KEYS.GAME_STATE(gameId), REDIS_KEYS.EXPIRY);
        await redis.set(REDIS_KEYS.GAME_START_TIME(gameId), game.startTimeUTC);
        await redis.expire(REDIS_KEYS.GAME_START_TIME(gameId), REDIS_KEYS.EXPIRY);

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

// --------------- Next Live Update -----------------
export async function nextLiveUpdateJob(gameId: number) {
    const logger = await Logger.Create('Jobs - Next Live Update');
    
    const subredditName = context.subredditName;
    const config = await getSubredditConfig(subredditName);

    // Guard: postId must exist, otherwise chain is orphaned
    const postId = await redis.get(REDIS_KEYS.GAME_TO_THREAD_ID(gameId));
    if (!postId) {
        logger.error(`No postId found for game ${gameId}. GDT chain terminated.`);
        return;
    }

    // Guard: terminal state ends the GDT chain — next scheduled job exits here.
    // If PGT is disabled, GDT runs until OFF (official) instead of stopping at FINAL.
    const cachedState = await redis.get(REDIS_KEYS.GAME_STATE(gameId));
    const gdtTerminalState = config
        ? config.postgame.enabled
            ? cachedState === GAME_STATES.FINAL || cachedState === GAME_STATES.OFF
            : cachedState === GAME_STATES.OFF
        : cachedState === GAME_STATES.OFF; // fail-safe: assume no PGT if config missing
    if (gdtTerminalState) {
        logger.info(`Game ${gameId} is in terminal GDT state (${cachedState}). Chain terminated.`);
        return;
    }

    // Guard: if game hasn't started yet, skip the API call
    const cachedStartTime = await redis.get(REDIS_KEYS.GAME_START_TIME(gameId));
    const isPreGame =
        (cachedState === GAME_STATES.FUT || cachedState === GAME_STATES.PRE || cachedState === GAME_STATES.PREVIEW) &&
        cachedStartTime !== null &&
        cachedStartTime !== undefined &&
        Date.now() < new Date(cachedStartTime).getTime();

    // Schedule next job before any risky work — chain survives failures from here
    await scheduleNextLiveUpdate(subredditName, postId, gameId, new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT));

    if (isPreGame) {
        logger.info(`Game ${gameId} has not started yet (state: ${cachedState}, start: ${cachedStartTime}). Skipping update.`);
        return;
    }

    // Config is required for everything below
    if (!config) {
        logger.error(`No config found for ${subredditName}. Skipping update, will retry next cycle.`);
        return;
    }

    // Verify post still exists on Reddit
    try {
        const existingPost = await reddit.getPostById(postId as Post["id"]);
        if (!existingPost) {
            logger.warn(`Post ${postId} not found on Reddit. Cleaning up.`);
            await tryCleanupThread(postId as Post["id"], config.gameday.lock);
            await redis.del(REDIS_KEYS.GAME_STATE(gameId));
            return;
        }
    } catch (err) {
        logger.error(`Failed to verify post exists: ${err instanceof Error ? err.message : String(err)}`);
        // Already scheduled — will retry next cycle
        return;
    }

    // Fetch game data
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
        // Already scheduled — will retry next cycle
        return;
    }

    if (!game) {
        // 304 — no changes, nothing to do
        logger.info(`Game data unchanged for game ${gameId}.`);
        return;
    }

    // Write new state to Redis
    await redis.set(REDIS_KEYS.GAME_STATE(gameId), game.gameState);
    await redis.expire(REDIS_KEYS.GAME_STATE(gameId), REDIS_KEYS.EXPIRY);

    if (modified && etag) {
        await redis.set(REDIS_KEYS.GAME_ETAG(gameId), etag);
        await redis.expire(REDIS_KEYS.GAME_ETAG(gameId), REDIS_KEYS.EXPIRY);
    }

    // Fetch officials from right-rail until confirmed, then use cache
    let officials: Officials | undefined;
    const cachedOfficialsJson = await redis.get(REDIS_KEYS.GDT_OFFICIALS(gameId));
    if (cachedOfficialsJson) {
        officials = JSON.parse(cachedOfficialsJson) as Officials;
    } else {
        try {
            const currentRREtag = await redis.get(REDIS_KEYS.GDT_RIGHTRAIL_ETAG(gameId));
            const rightRail = await getRightRailData(gameId, fetch, currentRREtag || undefined);
            if (rightRail.modified && rightRail.etag) {
                await redis.set(REDIS_KEYS.GDT_RIGHTRAIL_ETAG(gameId), rightRail.etag);
                await redis.expire(REDIS_KEYS.GDT_RIGHTRAIL_ETAG(gameId), REDIS_KEYS.EXPIRY);
            }
            if (rightRail.officials) {
                officials = rightRail.officials;
                await redis.set(REDIS_KEYS.GDT_OFFICIALS(gameId), JSON.stringify(officials));
                await redis.expire(REDIS_KEYS.GDT_OFFICIALS(gameId), REDIS_KEYS.EXPIRY);
                logger.info(`Officials confirmed for game ${gameId}. Caching and stopping right-rail polling.`);
            }
        } catch (err) {
            logger.warn(`Failed to fetch right-rail for officials: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    // If PGT is disabled and game is over, fetch and cache three stars for GDT display.
    // Keeps retrying each cycle until found or game reaches OFF.
    let threeStars: ThreeStar[] | undefined;
    if (!config.postgame.enabled && (game.gameState === GAME_STATES.FINAL || game.gameState === GAME_STATES.OFF)) {
        const cachedStars = await redis.get(REDIS_KEYS.PGT_THREE_STARS(gameId));
        if (cachedStars) {
            threeStars = JSON.parse(cachedStars) as ThreeStar[];
            logger.info(`Three stars for game ${gameId} loaded from cache.`);
        } else {
            try {
                const stars = await getThreeStars(gameId, fetch);
                if (stars) {
                    threeStars = stars;
                    await redis.set(REDIS_KEYS.PGT_THREE_STARS(gameId), JSON.stringify(stars));
                    await redis.expire(REDIS_KEYS.PGT_THREE_STARS(gameId), REDIS_KEYS.EXPIRY);
                    logger.info(`Three stars confirmed for game ${gameId}: ${stars.map(s => `#${s.star} ${s.name}`).join(', ')}.`);
                } else {
                    logger.info(`Three stars not yet available for game ${gameId}.`);
                }
            } catch (err) {
                logger.warn(`Failed to fetch three stars for GDT: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    const body = await formatThreadBody(game, officials, threeStars);
    const updateResult = await tryUpdateThread(postId as Post["id"], body);
    if (!updateResult.success) {
        logger.error(`Thread update failed for post ${postId}: ${updateResult.error}`);
        // Already scheduled — will retry next cycle
        return;
    }

    // Handle game end transition.
    // If PGT enabled: FINAL triggers PGT creation, GDT chain ends (next job reads FINAL/OFF from cache).
    // If PGT disabled: keep updating GDT until OFF so the thread reflects official results.
    if (game.gameState === GAME_STATES.FINAL || game.gameState === GAME_STATES.OFF) {
        if (config.postgame.enabled) {
            logger.info(`Game ${gameId} ended (${game.gameState}). Scheduling PGT.`);
            await scheduleCreatePostgameThread(game, new Date(Date.now() + UPDATE_INTERVALS.LIVE_GAME_DEFAULT));
        } else if (game.gameState === GAME_STATES.OFF) {
            logger.info(`Game ${gameId} results official (OFF), PGT disabled. Cleaning up GDT.`);
            await tryCleanupThread(postId as Post["id"], config.gameday.lock);
        } else {
            logger.info(`Game ${gameId} in FINAL, PGT disabled. Continuing GDT updates until OFF.`);
        }
        return;
    }

    // OT/SO: cancel the default-interval job and reschedule with shorter interval
    if (game.periodDescriptor?.periodType === "OT" || game.periodDescriptor?.periodType === "SO") {
        const scheduledJobId = await redis.get(REDIS_KEYS.JOB_GDT_UPDATE(gameId));
        if (scheduledJobId) {
            await tryCancelScheduledJob(scheduledJobId);
        }
        await scheduleNextLiveUpdate(subredditName, postId, gameId, new Date(Date.now() + UPDATE_INTERVALS.OVERTIME_SHOOTOUT));
        logger.info(`Game ${gameId} in ${game.periodDescriptor.periodType}. Switched to ${UPDATE_INTERVALS.OVERTIME_SHOOTOUT / 1000}s update interval.`);
    }

    /* NOTE: Disabled to keep intermission time remaining on thread
    if (game.clock?.inIntermission) {
        const intermissionRemaining = game.clock.secondsRemaining;
        if (intermissionRemaining > (UPDATE_INTERVALS.INTERMISSION / 1000)) {
            logger.debug(`Game is in intermission`);
            // cancel + reschedule with intermission-aware time
        }
    }
    */
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