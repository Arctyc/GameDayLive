import { redis, context, scheduler, ScheduledJob } from '@devvit/web/server';
import { getTodaysSchedule, NHLGame } from '../api';
import { UPDATE_INTERVALS, REDIS_KEYS, JOB_NAMES } from '../constants';
import { getSubredditConfig } from '../../../config';
import { Logger } from '../../../utils/Logger';
import { scheduleCreateGameThread } from './gameday';

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
                
                await redis.set(attemptKey, String(attemptNumber + 1));
                await redis.expire(attemptKey, 7200); // 2 hours TTL
                
                logger.info(`Rescheduling daily game check at ${retryTime.toISOString()}`);
                await scheduleDailyGameCheck(retryTime);
            } else {
                logger.error(`Failed to fetch schedule after ${attemptNumber + 1} attempts. Giving up.`);
                await redis.del(attemptKey);
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

        if (!game) {
            logger.info(`No game found for ${context.subredditName}: ${teamAbbrev}`);
            return;
        } 

        logger.info(`Game found for sub: ${context.subredditName} - ${game.awayTeam.abbrev} at ${game.homeTeam.abbrev}`);

        // Determine pre-game thread creation time
        const startTime = new Date(game.startTimeUTC).getTime();
        const scheduleTime = new Date(startTime - UPDATE_INTERVALS.PREGAME_THREAD_OFFSET);

        logger.debug(`Calling scheduleCreateGameThread with subreddit:${subredditName}, gameId: ${game.id}, time: ${scheduleTime.toISOString()}`);
        await scheduleCreateGameThread(subredditName, game, scheduleTime);
        
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