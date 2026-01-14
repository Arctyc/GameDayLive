import { redis } from '@devvit/redis';
import { scheduler } from '@devvit/web/server';
import { Router } from 'express';
import { Logger } from '../utils/Logger';

//DOCS: https://developers.reddit.com/docs/capabilities/server/scheduler#cancel-a-scheduled-job
/* Temproarily disabled


Router.post('/internal/menu/scheduled-jobs', async (req, res) => {
    const logger = await Logger.Create('Menu - Scheduled Jobs');

    try {
        //TODO: Lookup all stored job IDs in redis list

        // TODO: populate a select item with readable job names

        // TODO: cancel job

        //await scheduler.cancelJob(jobId);


    } catch (error) {
        
    }
})


*/