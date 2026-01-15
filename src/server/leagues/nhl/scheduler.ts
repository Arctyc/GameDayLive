import { Router } from 'express';
import { context } from '@devvit/web/server';
import { dailyGameCheckJob, createGameThreadJob, createPostgameThreadJob, nextLiveUpdateJob } from './jobs';
import { Logger } from '../../utils/Logger';

export const dailyGameCheck = (router: Router) => {
  router.post('/internal/scheduler/daily-game-check', async (_req, res) => {
    const logger = await Logger.Create('Scheduler - Daily Game Check');
    
    try {
      logger.info(`Running scheduled daily game check...`);
      await dailyGameCheckJob();
      res.status(200).json({ status: 'success' });
    } catch (error) {
      logger.error('Daily game check failed:', error);
      res.status(400).json({ 
        status: 'error', 
        message: 'Daily check failed',
        error: error instanceof Error ? error.message : String(error)
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
    } catch (error) {
      logger.error('Create game thread failed:', error);
      res.status(400).json({ 
        status: 'error', 
        message: 'Create game thread failed',
        error: error instanceof Error ? error.message : String(error)
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
    } catch (error) {
      logger.error('Create postgame thread failed:', error);
      res.status(400).json({ 
        status: 'error', 
        message: 'Create postgame thread failed',
        error: error instanceof Error ? error.message : String(error)
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
      
    } catch (error) {
      logger.error('Next live update failed:', error);
      res.status(400).json({ 
        status: 'error', 
        message: 'Next live update failed',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
};

export const registerSchedulers = (router: Router) => {
  dailyGameCheck(router);
  createGameThread(router);
  createPostgameThread(router)
  nextLiveUpdate(router);
};