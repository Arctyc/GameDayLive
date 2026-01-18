import { Router } from 'express';
import { dailyGameCheckJob, createGameThreadJob, createPostgameThreadJob, nextLiveUpdateJob, nextPGTUpdateJob } from './jobs';
import { Logger } from '../../utils/Logger';

export const dailyGameCheck = (router: Router) => {
  router.post('/internal/scheduler/daily-game-check', async (_req, res) => {
    const logger = await Logger.Create('Scheduler - Daily Game Check');
    
    try {
      logger.info(`Running scheduled daily game check...`);
      await dailyGameCheckJob();
      res.status(200).json({ status: 'success' });
    } catch (err) {
      logger.error('Daily game check failed:', err);
      res.status(200).json({ // TODO: Send success regardless to prevent crash, schedule retry logic in dailyGameCheckJob if necessary
        status: 'error', 
        message: 'Daily check failed',
        error: err instanceof Error ? err.message : String(err)
      });
    }
  });
};

export const createGameThread = (router: Router) => {
  router.post('/internal/scheduler/create-game-thread', async (_req, res) => {
    const logger = await Logger.Create('Scheduler - Create Game Thread');
    
    try {
      const { gameId } = _req.body.data || {}; // NOTE: Ensure proper destructuring
      if (!gameId) throw new Error('gameId required');
      await createGameThreadJob(gameId);
      res.status(200).json({ status: 'success' });
    } catch (err) {
      logger.error('Create game thread failed:', err);
      res.status(200).json({  // TODO: Send success regardless to prevent crash, schedule retry logic in createGameThreadJob if necessary
        status: 'error', 
        message: 'Create game thread failed',
        error: err instanceof Error ? err.message : String(err)
      });
    }
  });
};

export const createPostgameThread = (router: Router) => {
  router.post('/internal/scheduler/create-postgame-thread', async (_req, res) => {
    const logger = await Logger.Create('Scheduler - Create Postgame Thread');
    
    try {
      const { gameId } = _req.body.data || {};
      if (!gameId) throw new Error('gameId required');

      await createPostgameThreadJob(gameId);
      
      res.status(200).json({ status: 'success' });
    } catch (err) {
      logger.error('Create postgame thread failed:', err);
      res.status(200).json({ // TODO: Send success regardless to prevent crash, schedule retry logic in createPostgameThreadJob if necessary
        status: 'error', 
        message: 'Create postgame thread failed',
        error: err instanceof Error ? err.message : String(err)
      });
    }
  });
};

export const nextLiveUpdate = (router: Router) => {
  router.post('/internal/scheduler/next-live-update', async (_req, res) => {
    const logger = await Logger.Create('Scheduler - Next Live Update');

    try {
      const { gameId } = _req.body.data || {};
      if (!gameId) throw new Error('gameId required');

      await nextLiveUpdateJob(gameId);
      res.status(200).json({ status: 'success' });
      
    } catch (err) {
      logger.error('Next live update failed:', err);
      res.status(200).json({ 
        status: 'error', 
        message: 'Next live update failed',
        error: err instanceof Error ? err.message : String(err)
      });
    }
  });
};

export const nextPGTUpdate = (router: Router) => {
  router.post('/internal/scheduler/next-pgt-update', async (_req, res) => {
    const logger = await Logger.Create('Scheduler - Next PGT Update');

    try {
      const { gameId } = _req.body.data || {};
      if (!gameId) throw new Error('gameId required');

      await nextPGTUpdateJob(gameId);
      res.status(200).json({ status: 'success' });
      
    } catch (err) {
      logger.error('Next live update failed:', err);
      res.status(200).json({ 
        status: 'error', 
        message: 'Next PGT update failed',
        error: err instanceof Error ? err.message : String(err)
      });
    }
  });
};

export const registerSchedulers = (router: Router) => {
  dailyGameCheck(router);
  createGameThread(router);
  createPostgameThread(router);
  nextLiveUpdate(router);
  nextPGTUpdate(router);
};