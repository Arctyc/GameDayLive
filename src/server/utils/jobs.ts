import { ScheduledCronJob, ScheduledJob, scheduler } from "@devvit/web/server";
import { Logger } from "./Logger";

export async function getJobData(jobId: string): Promise<ScheduledJob | ScheduledCronJob | undefined> {
    const logger = await Logger.Create(`Global Jobs - Get Job Data`);

    try {
        const jobs: (ScheduledJob | ScheduledCronJob)[] = await scheduler.listJobs();
        logger.debug(`[LIST] Found ${jobs.length} scheduled jobs`);

        const foundJob = jobs.find(job => job.id === jobId);

        if (foundJob) {
            logger.info(`Found job: ${foundJob.data?.jobTitle}`);
            return foundJob;
        }
    } catch (err) {
        logger.error(`Error finding job. ${err}`);
    }
}