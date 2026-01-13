import { Router } from 'express';
import { context, redis, reddit } from '@devvit/web/server';
import { getTodaysSchedule, NHLGame } from '../leagues/nhl/api';
// import { Logger } from '../utils/Logger';

// ==================== Daily Game Check ====================
export const dailyGameCheck = (router: Router) => {
  router.post('/internal/scheduler/daily-game-check', async (_req, res) => {
    // const logger = await Logger.Create('Scheduler - Daily Game Check'); // TODO: implement proper logging
    // logger.traceStart();

    try {
      const subreddit = context.subredditName;
      if (!subreddit) throw new Error('subredditName required');

      // Fetch today's NHL games
      const todayGames: NHLGame[] = await getTodaysSchedule(fetch); // TODO: pass fetch or use global fetch

      // Queue thread creation in the off chance two games are played in one 24-hour period
      for (const game of todayGames) {
        await redis.hSet('gameQueue', { [game.id.toString()]: JSON.stringify(game) });
      }

      // logger.info(`Queued ${todayGames.length} games for subreddit ${subreddit}`); // TODO: implement proper logging
      res.status(200).json({ status: 'success' });
    } catch (error) {
      // logger.error('Daily Game Check failed:', error); // TODO: implement proper logging
      res.status(400).json({ status: 'error', message: 'Daily check failed' });
    } finally {
      // logger.traceEnd(); // TODO: implement proper logging
    }
  });
};

// ==================== Create Game Thread ====================
export const createGameThread = (router: Router) => {
  router.post('/internal/scheduler/create-game-thread', async (_req, res) => {
    // const logger = await Logger.Create('Scheduler - Create Game Thread'); // TODO: implement proper logging
    // logger.traceStart();

    try {
      const subreddit = context.subredditName;
      if (!subreddit) throw new Error('subredditName required');

      const queuedGames = await redis.hGetAll('gameQueue');
      for (const [gameId, gameDataStr] of Object.entries(queuedGames)) {
        const gameData: NHLGame = JSON.parse(gameDataStr);

        // Create post for this game
        await reddit.submitCustomPost({
          subredditName: subreddit,
          title: `Game Thread: ${gameData.awayTeam.commonName.default} @ ${gameData.homeTeam.commonName.default}`,
          postData: { gameId },
        });

        // Optionally: schedule first live update
        await scheduleNextLiveUpdate(gameData); // TODO: implement this
      }

      // Clear queue
      await redis.del('gameQueue');

      // logger.info('Created game threads successfully'); // TODO: implement proper logging
      res.status(200).json({ status: 'success' });
    } catch (error) {
      // logger.error('Create Game Thread failed:', error); // TODO: implement proper logging
      res.status(400).json({ status: 'error', message: 'Create game thread failed' });
    } finally {
      // logger.traceEnd(); // TODO: implement proper logging
    }
  });
};

// ==================== Next Live Update ====================
export const nextLiveUpdate = (router: Router) => {
  router.post('/internal/scheduler/next-live-update', async (_req, res) => {
    // const logger = await Logger.Create('Scheduler - Next Live Update'); // TODO: implement proper logging
    // logger.traceStart();

    try {
      const subreddit = context.subredditName;
      if (!subreddit) throw new Error('subredditName required');

      // gameId should be passed via postData when this scheduled action is created
      const { gameId } = _req.body;
      if (!gameId) throw new Error('gameId required');

      const gameDataStr = await redis.get(`game:${gameId}`);
      if (!gameDataStr) throw new Error('Game data not found');

      const gameData: NHLGame = JSON.parse(gameDataStr);

      // TODO: Edit existing thread with live update
      //

      // TODO: Schedule next update if the game is still ongoing
      //

      // logger.info(`Live update processed for game ${gameId}`); // TODO: implement proper logging
      res.status(200).json({ status: 'success' });
    } catch (error) {
      // logger.error('Next Live Update failed:', error); // TODO: implement proper logging
      res.status(400).json({ status: 'error', message: 'Next live update failed' });
    } finally {
      // logger.traceEnd();  // TODO: implement proper logging
    }
  });
};

// ==================== Register all scheduler actions ====================
export const registerSchedulers = (router: Router) => {
  dailyGameCheck(router);
  createGameThread(router);
  nextLiveUpdate(router);
};