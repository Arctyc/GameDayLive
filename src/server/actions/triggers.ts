import { Router } from 'express';
import { Logger } from '../utils/Logger';
import { tryCleanupThread } from '../threads';
import { Post } from '@devvit/web/server';
import { APPNAME } from '../types';

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
    router.post('/internal/triggers/delete-post', async (req, res): Promise<void> => {
        const logger = await Logger.Create('Trigger - Delete Post');
        logger.info(`Post delete trigger called.`);

        const post = req.body.post;
        const postId = req.body.postId;

        // Only process self-posts
        if (post.authorName !== APPNAME){
            logger.debug(`Ignoring unowned post deletion... App = ${APPNAME} - Author = ${post.authorName}`);
        }
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