import { scheduler, ScheduledJob, ScheduledCronJob } from '@devvit/web/server';
import { Router } from 'express';
import { Logger } from '../utils/Logger';
import { tryCancelScheduledJob } from '../threads';

//DOCS: https://developers.reddit.com/docs/capabilities/server/scheduler#cancel-a-scheduled-job

export const jobMenuAction = (router: Router): void => {
   router.post('/internal/menu/scheduled-jobs', async (_req, res) => {
      const logger = await Logger.Create('Menu - Scheduled Jobs');

      try {
         // TODO: Lookup all stored job IDs in redis list
         const jobs: (ScheduledJob | ScheduledCronJob)[] = await scheduler.listJobs();
         const jobOptions = jobs.map(job => {
            const data = job.data as { jobTitle?: string };

            return {
               label: data?.jobTitle ?? job.id,
               value: job.id
            };
         });

         logger.info(`[LIST] Found ${jobs.length} scheduled jobs`);

         // TODO: populate a form with readable job names
         res.json({
            showForm: {
               name: 'cancelJobForm',
               form: {
                  title: 'Cancel a scheduled job',
                  fields: [
                     {
                        type: 'select',
                        name: 'jobs',
                        label: 'Jobs',
                        options: jobOptions,
                        required: true,
                     }
                  ],
                  acceptLabel: 'Cancel selected job',
               }
            }
         });

      } catch (error) {

         // TODO: Catch error
      }
   });
}

export const jobCancelAction = (router: Router): void => {
   router.post(
      '/internal/form/cancel-job-form',
      async (req, res): Promise<void> => {
         const logger = await Logger.Create('Form - Cancel Job');

         try {
            const { jobs } = req.body;

            // select fields always return string or string[]
            const jobId = Array.isArray(jobs) ? jobs[0] : jobs;

            const allJobs = await scheduler.listJobs();
            const job = allJobs.find(j => j.id === jobId);

            if (!job) {
               res.status(400).json({
                  showToast: {
                     appearance: 'error',
                     text: 'No job selected.'
                  }
               });
               return;
            }

            // Cancel scheduled job
            logger.info(`Attempting to cancel job ${jobId}`);
            const jobTitle = (job.data as { jobTitle?: string })?.jobTitle ?? job.id;
            const result = await tryCancelScheduledJob(jobTitle);
            if (!result.ok) {
               logger.warn(`Thread cleanup failed for ${jobTitle}: ${result.reason}`);

               res.status(500).json({
                  showToast: {
                     appearance: 'error',
                     text: 'Job cancelled, but thread cleanup failed.'
                  }
               });
               return;
            }
            
            res.status(200).json({
               showToast: {
                  appearance: 'success',
                  text: `Cancelled job: ${jobId}`
               }
            });

         } catch (error) {
            logger.error('Error cancelling job:', error);

            res.status(400).json({
               showToast: {
                  appearance: 'error',
                  text: 'Failed to cancel job.'
               }
            });
         }
      }
   );
};