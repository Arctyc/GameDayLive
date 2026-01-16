import { Router } from 'express';
import { Logger } from '../utils/Logger';
import { tryCleanupThread } from '../threads';

export const onAppInstallAction = (router: Router): void => {
    // Placeholder
    router.post('/internal/triggers/install', async (_req, res): Promise<void> => {
        res.json({
        status: 'success',
        message: `Placeholder for Install Trigger`
        });
    });
    
    /*
    router.post('/internal/triggers/install', async (_req, res) => {
        const logger = await Logger.Create('Trigger - Install');
        logger.debug(`App install trigger called.`);
        // Take action       
        res.status(200).json({ status: 'ok'});
    });
    */
}

export const onAppUpgradeAction = (router: Router): void => {
    // Placeholder
    router.post('/internal/triggers/upgrade', async (_req, res): Promise<void> => {
        res.json({
        status: 'success',
        message: `Placeholder for Update Trigger`
        });
    });

    /*
    router.post('/internal/triggers/upgrade', async (_req, res) => {
        const logger = await Logger.Create('Trigger - Upgrade');
        logger.debug(`App upgrade trigger called.`);
        // Take action          
        res.status(200).json({ status: 'ok'});
    });
    */
}

export const onPostDeleteAction = (router: Router): void => {
    // Placeholder
    router.post('/internal/triggers/delete-post', async (_req, res): Promise<void> => {
        res.json({
        status: 'success',
        message: `Placeholder for Delete Post Trigger`
        });
    });

    /*
    router.post('/internal/triggers/delete-post', async (req, res) => {
        const logger = await Logger.Create('Trigger - Install');
        logger.debug(`Post delete trigger called.`);
        // TODO: Compare source to app to ensure app didn't delete?
        //const source = req.body.source;

        const postId = req.body.postId;
        await tryCleanupThread(postId);
        res.status(200).json({ status: 'ok'});
    });
    */
}


export const registerTriggers = (router: Router) => {
  onAppInstallAction(router);
  onAppUpgradeAction(router);
  onPostDeleteAction(router)
};