import { Router } from 'express';
import { context } from '@devvit/web/server';
import { dailyGameCheckJob, createGameThreadJob, nextLiveUpdateJob } from './gameScheduler';

export const dailyGameCheck = (router: Router) => {
  router.post('/internal/scheduler/daily-game-check', async (_req, res) => {
    try {
      await dailyGameCheckJob(context.subredditName!);
      res.status(200).json({ status: 'success' });
    } catch (error) {
      res.status(400).json({ status: 'error', message: 'Daily check failed' });
    }
  });
};

export const createGameThread = (router: Router) => {
  router.post('/internal/scheduler/create-game-thread', async (_req, res) => {
    try {
      const { gameId } = _req.body;
      if (!gameId) throw new Error('gameId required');
      await createGameThreadJob(gameId, context.subredditName!);
      res.status(200).json({ status: 'success' });
    } catch (error) {
      res.status(400).json({ status: 'error', message: 'Create game thread failed' });
    }
  });
};

export const nextLiveUpdate = (router: Router) => {
  router.post('/internal/scheduler/next-live-update', async (_req, res) => {
    try {
      const { gameId } = _req.body;
      if (!gameId) throw new Error('gameId required');
      await nextLiveUpdateJob(gameId, context.subredditName!);
      res.status(200).json({ status: 'success' });
    } catch (error) {
      res.status(400).json({ status: 'error', message: 'Next live update failed' });
    }
  });
};

export const registerSchedulers = (router: Router) => {
  dailyGameCheck(router);
  createGameThread(router);
  nextLiveUpdate(router);
};