import { redis, context, scheduler, ScheduledJob } from '@devvit/web/server';
import { getTodaysSchedule, NHLGame } from '../api';
import { UPDATE_INTERVALS, REDIS_KEYS, JOB_NAMES } from '../constants';
import { getSubredditConfig } from '../../../config';
import { Logger } from '../../../utils/Logger';
import { scheduleCreateGameThread } from './gameday';
import { schedulePregameThread } from './pregame';
import { scheduleNextPGTMonitor } from './postgame';

// --------------- Daily Game Check -----------------
export async function dailyGameCheckJob() {
    const logger = await Logger.Create('Jobs - Daily Game Check');
    
    const attemptKey = REDIS_KEYS.DAILY_CHECK_ATTEMPTS();
    const apiAttemptKey = REDIS_KEYS.DAILY_CHECK_API_ATTEMPTS();
    const attemptNumber = parseInt(await redis.get(attemptKey) || '0');
    const apiAttemptNumber = parseInt(await redis.get(apiAttemptKey) || '0');
    
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
            
            if (apiAttemptNumber < 5) {
                const backoffMs = Math.min(60000 * Math.pow(2, apiAttemptNumber), UPDATE_INTERVALS.RETRY_MAX_TIME);
                const retryTime = new Date(Date.now() + backoffMs);
                
                await redis.set(apiAttemptKey, String(apiAttemptNumber + 1));
                await redis.expire(apiAttemptKey, 7200);
                
                logger.info(`Rescheduling daily game check at ${retryTime.toISOString()}`);
                await scheduleDailyGameCheck(retryTime);
            } else {
                logger.error(`Failed to fetch schedule after ${apiAttemptNumber + 1} attempts. Giving up.`);
                await redis.del(apiAttemptKey);
            }
            return;
        }
        
        // Success - clear attempt counter
        await redis.del(attemptKey);
        await redis.del(apiAttemptKey);
        
        const todayGamesIds = todayGames.map(g => g.id).join(', ');
        logger.info(`Team: ${teamAbbrev}, Games: ${todayGamesIds}`);

        // Filter by the subreddit's NHL team
        const game = todayGames.find(
            g => g.homeTeam.abbrev === teamAbbrev || g.awayTeam.abbrev === teamAbbrev
        );

        if (!game) {
            logger.info(`No game found for ${context.subredditName}: ${teamAbbrev}`);
            return;
        } 

        logger.info(`Game found for sub: ${context.subredditName} - ${game.awayTeam.abbrev} at ${game.homeTeam.abbrev}`);

        // Schedule pregame thread immediately if enabled
        if (config.pregame.enabled) {
            const gameStartMs = new Date(game.startTimeUTC).getTime();
            const twoHoursMs = 2 * 60 * 60 * 1000;
            const alreadyCreated = await redis.get(REDIS_KEYS.GAME_TO_PREGAME_ID(game.id));

            if (alreadyCreated) {
                logger.info(`Pre-game thread already exists for game ${game.id}. Skipping.`);
            } else if (gameStartMs - Date.now() <= twoHoursMs) {
                logger.info(`Game ${game.id} starts in ≤2 hours. Too late to create a pre-game thread.`);
            } else {
                logger.info(`Pre-game threads enabled. Scheduling pre-game thread now.`);
                await schedulePregameThread(game, new Date());
            }
        }

        // Determine GDT thread creation time
        const startTime = new Date(game.startTimeUTC).getTime();
        const scheduleTime = new Date(startTime - UPDATE_INTERVALS.PREGAME_THREAD_OFFSET);

        logger.debug(`Calling scheduleCreateGameThread with subreddit:${subredditName}, gameId: ${game.id}, time: ${scheduleTime.toISOString()}`);
        await scheduleCreateGameThread(subredditName, game, scheduleTime);

        // If GDT is disabled but PGT is enabled, start the PGT monitor instead.
        // The monitor polls game state and fires PGT creation when the game ends.
        if (!config.gameday.enabled && config.postgame.enabled) {
            const existingMonitor = await redis.get(REDIS_KEYS.JOB_PGT_MONITOR(game.id));
            if (existingMonitor) {
                logger.info(`PGT monitor already scheduled for game ${game.id}. Skipping.`);
            } else {
                // Seed start time so the monitor can skip pre-game API calls
                await redis.set(REDIS_KEYS.GAME_START_TIME(game.id), game.startTimeUTC);
                await redis.expire(REDIS_KEYS.GAME_START_TIME(game.id), REDIS_KEYS.EXPIRY);

                // Start at game time, or now if already in progress
                const monitorStartTime = new Date(Math.max(startTime, Date.now()));
                logger.info(`GDT disabled, PGT enabled. Scheduling PGT monitor for game ${game.id} at ${monitorStartTime.toISOString()}.`);
                await scheduleNextPGTMonitor(game.id, monitorStartTime);
            }
        }
        
    } catch (err) {
        logger.error(`Daily game check failed: ${err instanceof Error ? err.message : String(err)}`);
        
        if (attemptNumber < 5) {
            const backoffMs = Math.min(60000 * Math.pow(2, attemptNumber), 1800000); // Max 30 min
            const retryTime = new Date(Date.now() + backoffMs);
            
            await redis.set(attemptKey, String(attemptNumber + 1));
            await redis.expire(attemptKey, 7200);
            
            logger.info(`Rescheduling daily game check at ${retryTime.toISOString()}`);
            await scheduleDailyGameCheck(retryTime);
        } else {
            logger.error(`Daily game check failed after ${attemptNumber + 1} attempts. Giving up.`);
            await redis.del(attemptKey);
            await redis.del(apiAttemptKey);
        }
    }
}

// --------------- Schedule Daily Game Check -----------------
export async function scheduleDailyGameCheck(runAt: Date) {
    const logger = await Logger.Create('Jobs - Schedule Daily Game Check');

    const job: ScheduledJob = {
        id: `daily-game-check`,
        name: JOB_NAMES.DAILY_GAME_CHECK,
        data: {},
        runAt: runAt,
    };

    try {
        logger.debug(`Attempting to schedule daily game check at ${runAt.toISOString()}`);

        if (runAt.getTime() < Date.now()) {
            logger.warn(`Warning: scheduledTime ${runAt.toISOString()} is in the past. Job may run immediately or fail.`);
        }

        const jobId = await scheduler.runJob(job);
        
        await redis.set(REDIS_KEYS.JOB_DAILY_CHECK(), jobId);
        await redis.expire(REDIS_KEYS.JOB_DAILY_CHECK(), REDIS_KEYS.EXPIRY);
        
        logger.info(`Successfully scheduled daily game check job ID: ${jobId}`);

    } catch (err) {
        logger.error(`Failed to schedule daily game check: ${err instanceof Error ? err.message : String(err)}`);
    }
}