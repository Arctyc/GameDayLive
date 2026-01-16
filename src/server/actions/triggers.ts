import { Router } from 'express';
import { Logger } from '../utils/Logger';
import { tryCancelScheduledJob, tryCleanupThread } from '../threads';

export const onAppInstallAction = (router: Router): void => {
    router.post('/internal/triggers/install', async (_req, res) => {
        const logger = await Logger.Create('Trigger - Install');
        logger.debug(`App install trigger called.`);
        // Take action       
        res.status(200).json({ status: 'ok'});
    });
}

export const onAppUpgradeAction = (router: Router): void => {
    router.post('/internal/triggers/upgrade', async (_req, res) => {
        const logger = await Logger.Create('Trigger - Upgrade');
        logger.debug(`App upgrade trigger called.`);
        // Take action          
        res.status(200).json({ status: 'ok'});
    });
}

export const onPostDeleteAction = (router: Router): void => {
    router.post('/internal/triggers/delete-post', async (req, res) => {
        const logger = await Logger.Create('Trigger - Install');
        logger.debug(`Post delete trigger called.`);
        // TODO: Compare source to app to ensure app didn't delete?
        //const source = req.body.source;

        const postId = req.body.postId;
        await tryCleanupThread(postId);
        res.status(200).json({ status: 'ok'});
    });
}