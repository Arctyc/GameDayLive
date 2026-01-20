import { Router } from 'express';
import { Logger } from '../utils/Logger';
import { tryCleanupThread } from '../threads';

export const onAppInstallAction = (router: Router): void => {
    // Placeholder
    router.post('/internal/triggers/install', async (_req, res): Promise<void> => {
        res.json({
        status: 'success',
        message: `Install Trigger`
        });
    });
    
    /*
    router.post('/internal/triggers/install', async (_req, res) => {
        const logger = await Logger.Create('Trigger - Install');
        logger.info(`App install trigger called.`);
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
        message: `Update Trigger`
        });
    });

    /*
    router.post('/internal/triggers/upgrade', async (_req, res) => {
        const logger = await Logger.Create('Trigger - Upgrade');
        logger.info(`App upgrade trigger called.`);
        // Take action          
        res.status(200).json({ status: 'ok'});
    });
    */
}

export const onPostDeleteAction = (router: Router): void => {
    // Placeholder
    router.post('/internal/triggers/delete-post', async (req, res): Promise<void> => {
        const logger = await Logger.Create('Trigger - Delete Post');
        logger.info(`Post delete trigger called.`);

        const postId = req.body.postId;
        await tryCleanupThread(postId);

        res.json({
        status: 'success',
        message: `Delete Post Trigger`
        });
    });
}


export const registerTriggers = (router: Router) => {
  onAppInstallAction(router);
  onAppUpgradeAction(router);
  onPostDeleteAction(router)
};