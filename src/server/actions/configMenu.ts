import { Router } from 'express';
import { context, ScheduledJob, ScheduledCronJob, scheduler } from '@devvit/web/server';
import { LEAGUES, SubredditConfig } from '../types';
import { NHLConfig } from '../leagues/nhl/types';
import { getTeamsForLeague } from '../leagues';
import { getSubredditConfig, setSubredditConfig } from '../config';
import { getTeamLabel } from '../leagues/nhl/config';
import { APPROVED_NHL_SUBREDDITS } from '../leagues/nhl/config';
import { dailyGameCheckJob } from '../leagues/nhl/jobs';
import { tryCancelScheduledJob } from '../threads';
import { Logger } from '../utils/Logger';
import { sendModmail } from '../modmail';

export const menuAction = (router: Router): void => {
    router.post(
        '/internal/menu/config-menu',
        async (_req, res): Promise<void> => {
            const logger = await Logger.Create('Menu - Config');
              
            try {
                // Try to retrieve existing settings
                let config: SubredditConfig | undefined;
                try {
                    config = await getSubredditConfig(context.subredditName);

                } catch (err) {
                    logger.warn('Failed to fetch existing config', err);
                }

                // Determine defaults
                const defaultLeague = config?.league ? [config.league] : [LEAGUES[0]];
                const teamsForLeague = getTeamsForLeague(config?.league ?? LEAGUES[0]) ?? [];
                const defaultTeam = config?.nhl?.teamAbbreviation ? [config.nhl.teamAbbreviation] : teamsForLeague[0] ? [teamsForLeague[0].value] : [];
                const defaultPGT = config?.enablePostgameThreads ?? true;
                const defaultSticky = config?.enableThreadSticky ?? true;
                const defaultLock = config?.enableThreadLocking ?? true;

                // Build form
                res.json({
                    showForm: {
                        name: 'subredditConfigForm',
                        form: {
                            title: 'GameDayLive Configuration',
                            fields: [
                            {
                                type: 'select',
                                name: 'league',
                                label: 'League',
                                options: LEAGUES.map((l: typeof LEAGUES[number]) => ({
                                label: l.toUpperCase(),
                                value: l
                                })),
                                defaultValue: defaultLeague,
                                onValueChanged: 'refresh',
                                required: true,
                            },
                            {
                                type: 'select',
                                name: 'team',
                                label: 'Team',
                                options: teamsForLeague,
                                defaultValue: defaultTeam,
                                required: true,
                            },
                            {
                                type: 'boolean',
                                name: 'enablePostgameThreads',
                                label: 'Enable post-game threads',
                                defaultValue: defaultPGT,
                            },
                            {
                                type: 'boolean',
                                name: 'enableThreadSticky',
                                label: 'Enable sticky threads',
                                defaultValue: defaultSticky,
                            },
                            {
                                type: 'boolean',
                                name: 'enableThreadLocking',
                                label: 'Enable thread locking',
                                defaultValue: defaultLock,
                            }
                            ],
                            acceptLabel: 'Save',
                        }
                    }
                });
            } catch (err) {
                logger.error(`Error in config menu: ${err}`);
            }
        }
    )
}

export const formAction = (router: Router): void => {
    router.post(
        '/internal/form/config-form',
        async (req, res): Promise<void> => {
            const logger = await Logger.Create('Form - Config');

            try {
                // Extract form data
                const { league, team, enablePostgameThreads, enableThreadSticky, enableThreadLocking } = req.body;
                
                // Select field results are sent as array[0]
                const leagueValue = league[0];
                const teamValue = team[0];
                // Bools
                const enablePostgameThreadsValue = enablePostgameThreads;
                const enableThreadStickyValue = enableThreadSticky;
                const enableThreadLockingValue = enableThreadLocking;


                // Don't allow empty selection for league or team
                if (!leagueValue || !teamValue) {
                    res.status(200).json({
                        showToast: {
                            appearance: 'error',
                            text: 'League and team must be selected.'
                        }
                    });
                    return;
                }

                // Don't allow unapproved subreddit to configure
                // HACK: Process this with some proper notification like modmail, don't rely on toast.
                // TODO: In fact, there should be a modmail or something sent with confirmation of setup regardless.
                // DOCS: modmail instructions https://discord.com/channels/1050224141732687912/1461467837548986389/1461468906253451396
                const subreddit = context.subredditName?.toLowerCase();

                if ( !subreddit || !APPROVED_NHL_SUBREDDITS.some(s => s.toLowerCase() === subreddit.toLowerCase())) {

                    const subject = getDenySubject();
                    const body = getDenyBody();
                    const conversationId = sendModmail(subject, body);

                    logger.warn(`Unauthorized subreddit attempted config: ${subreddit}, ${conversationId}`);                    

                    res.status(200).json({
                        showToast: {
                            text: `Configuration denied - unauthorized subreddit. For more info: r/gamedaylive_dev`
                        }
                    });
                    return;
                }
                // Approval is sent after config

                // -------- CONFIG --------
                // Build subredditConfig object
                const config: SubredditConfig = {
                    league: leagueValue,
                    enablePostgameThreads: !!enablePostgameThreadsValue,
                    enableThreadSticky: !! enableThreadStickyValue,
                    enableThreadLocking: !!enableThreadLockingValue,
                    ...(teamValue ? { nhl: { teamAbbreviation: teamValue } as NHLConfig } : {}),                    
                };

                // Store in redis using helper function
                //NOTE:logger.debug(`Attempting to store config for ${context.subredditName}`)
                await setSubredditConfig(context.subredditName, config);

                // Pull saved team name to confirm with toast/modmail
                const savedConfig = await getSubredditConfig(context.subredditName)

                const savedLeagueValue = "NHL"; // FIX: Make dynamic when leagues are dynamic
                let savedTeamValue = savedConfig?.nhl?.teamAbbreviation;
                if (!savedTeamValue){
                    logger.error(`Team did not save in config`);
                    savedTeamValue = "N/A";
                }
                const enablePGTValue = savedConfig?.enablePostgameThreads as boolean;
                const enableStickyValue = savedConfig?.enableThreadSticky as boolean;
                const enableLockValue = savedConfig?.enableThreadLocking as boolean;                

                const subject = getApprovalSubject();
                const body = getApprovalBody(savedLeagueValue, savedTeamValue, enablePGTValue, enableStickyValue, enableLockValue);

                const conversationId = await sendModmail(subject, body);
                logger.info(`Sent approval modmail to sub: ${context.subredditName} with conversation ID: ${conversationId}`);

                // -------- DUPLICATE CHECKING --------
                // Check for existing scheduled Create Game Thread job (any game ID)

                try {
                    const prefix = `Game Day Thread`;
                    const jobs: (ScheduledJob | ScheduledCronJob)[] = await scheduler.listJobs();
                    const jobTitles = jobs.map(job => {
                        const data = job.data as { jobTitle?: string };

                        return {
                        label: data?.jobTitle ?? job.id,
                        value: job.id
                        };
                    });

                    const matchingJob = jobTitles.find(j => j.label.includes(prefix));
                    // If found, cancel the job and remove the redis lock, 1 sub = 1 thread FIX: (currently per game, future = any)
                    if (matchingJob) {
                        const jobTitle = matchingJob.label; 
                        const result = await tryCancelScheduledJob(jobTitle);

                        if (result) {
                            // Job was canceled
                            logger.info(`Job: ${jobTitle} already exists. Overwriting...`);
                        } else {
                            // Duplicate thread may occur.
                            logger.warn(`Existing pending job: ${jobTitle} found. Duplicate thread may occur.`);
                        }
                    }
                } catch (err) {
                    logger.error(`Error during duplication check`, err);
                }
                
                
                // -------- Daily game scheduler --------
                // HACK:FIX: Determine job to run based on league selection
                // Run daily game check immediately
                await dailyGameCheckJob();           

                // Send success toast
                const teamName = getTeamLabel(savedTeamValue);
                res.status(200).json({
                    showToast: {
                        appearance: 'success',
                        text: `Configuration saved for team: ${teamName}`
                    }
                });

            } catch (err) {
                logger.error('Error saving subreddit config:', err);
                res.status(200).json({
                    showToast: {
                        appearance: 'error',
                        text: `Failed to save configuration.`
                    }
                });
            }
        }
    );
};

function getApprovalSubject(): string {
    return `Confirming your GameDayLive configuration settings`;
}

function getApprovalBody(league: string, team: string, pgt: boolean, sticky: boolean, lock: boolean): string {
    const pgtString = pgt ? 'Enabled' : 'Disabled';
    const stickyString = sticky ? `Enabled` : `Disabled`;
    const lockString = lock ? `Enabled` : `Disabled`;

    return`Thank you for using GameDayLive! Here are your saved configuration settings. If anything doesn't look right, simply reconfigure and save. 

League: ${league}  
Team: ${team}  
Post-game Threads: ${pgtString}  
Sticky threads: ${stickyString}  
Lock threads: ${lockString}  

If thread locking is enabled, game day threads will be locked when when the PGT is posted, or in the event PGT is disabled, after the game.  
PGTs will be locked 18 hours after post.  

Tip: Some errors that interrupt the bot's functionality may be sent in modmail to notify you.  
If you come across any issues, such as a game day thread not receiving updates, you can re-save your config form to try to get the bot to recover.  
If that doesn't solve the problem, you can uninstall and reinstall the bot. Please notify me of any issues you encounter so I can look into them and try to resolve them. Thanks!

If you have any questions, feel free to reach out via the contact information found on [the app's devvit page.](https://developers.reddit.com/apps/gamedaylive)`;
}

function getDenySubject(): string {
    return `This subreddit requires authorization to configure GameDayLive`;
}

function getDenyBody(): string {
    return `Thank you for your interest in GameDayLive! Due to API rate limits, we maintain a list of approved subreddits.  
To request approval, please contact the operator of this app via the contact information on [the app's devvit page.](https://developers.reddit.com/apps/gamedaylive)`;
}