import { Router } from 'express';
import { context, ScheduledJob, ScheduledCronJob, scheduler } from '@devvit/web/server';
import { LEAGUES, SubredditConfig, ThreadConfig } from '../types';
import { NHLConfig } from '../leagues/nhl/types';
import { getTeamsForLeague } from '../leagues';
import { getSubredditConfig, setSubredditConfig } from '../config';
import { getTeamLabel } from '../leagues/nhl/config';
import { APPROVED_NHL_SUBREDDITS } from '../leagues/nhl/config';
import { dailyGameCheckJob } from '../leagues/nhl/jobs';
import { tryCancelScheduledJob } from '../threads';
import { Logger } from '../utils/Logger';
import { sendModmail } from '../modmail';

// -------- CONSTANTS --------

const DEFAULT_THREAD: ThreadConfig = {
    enabled: true,
    sticky: true,
    lock: true,
    sort: 'new',
};

// -------- MENU ACTION — Form 1 --------

export const menuAction = (router: Router): void => {
    router.post(
        '/internal/menu/config-menu',
        async (_req, res): Promise<void> => {
            const logger = await Logger.Create('Menu - Config');

            try {
                let config: SubredditConfig | undefined;
                try {
                    config = await getSubredditConfig(context.subredditName);
                } catch (err) {
                    logger.warn('Failed to fetch existing config', err);
                }

                const defaultLeague = config?.league ? [config.league] : [LEAGUES[0]];
                const teamsForLeague = getTeamsForLeague(config?.league ?? LEAGUES[0]) ?? [];
                const defaultTeam = config?.nhl?.teamAbbreviation
                    ? [config.nhl.teamAbbreviation]
                    : teamsForLeague[0]
                    ? [teamsForLeague[0].value]
                    : [];

                res.json({
                    showForm: {
                        name: 'configStep1Form',
                        form: {
                            title: 'GameDayLive — Step 1 of 2',
                            fields: [
                                {
                                    type: 'select',
                                    name: 'league',
                                    label: 'League',
                                    options: LEAGUES.map((l: typeof LEAGUES[number]) => ({
                                        label: l.toUpperCase(),
                                        value: l,
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
                                    name: 'pregameEnabled',
                                    label: 'Enable pre-game threads (Coming soon)',
                                    defaultValue: config?.pregame?.enabled ?? false,
                                },
                                {
                                    type: 'boolean',
                                    name: 'gamedayEnabled',
                                    label: 'Enable game day threads',
                                    defaultValue: config?.gameday?.enabled ?? true,
                                },
                                {
                                    type: 'boolean',
                                    name: 'postgameEnabled',
                                    label: 'Enable post-game threads',
                                    defaultValue: config?.postgame?.enabled ?? true,
                                },
                            ],
                            acceptLabel: 'Next',
                        },
                    },
                });
            } catch (err) {
                logger.error(`Error in config menu: ${err}`);
            }
        }
    );
};

// -------- FORM ACTION — Chain Form 2 --------

export const formStep1Action = (router: Router): void => {
    router.post(
        '/internal/form/config-step1-form',
        async (req, res): Promise<void> => {
            const logger = await Logger.Create('Form - Config Step 1');

            try {
                const { league, team, pregameEnabled, gamedayEnabled, postgameEnabled } = req.body;

                const leagueValue = league[0] as typeof LEAGUES[number];
                const teamValue = team[0] as string;

                if (!leagueValue || !teamValue) {
                    res.status(200).json({
                        showToast: {
                            appearance: 'error',
                            text: 'League and team must be selected.',
                        },
                    });
                    return;
                }

                if (!pregameEnabled && !gamedayEnabled && !postgameEnabled) {
                    res.status(200).json({
                        showToast: {
                            appearance: 'error',
                            text: 'At least one thread type must be enabled.',
                        },
                    });
                    return;
                }

                // Authorization check — do this before any writes
                const subreddit = context.subredditName?.toLowerCase();
                if (!subreddit || !APPROVED_NHL_SUBREDDITS.some(s => s.toLowerCase() === subreddit)) {
                    const conversationId = sendModmail(getDenySubject(), getDenyBody());
                    logger.warn(`Unauthorized subreddit attempted config: ${subreddit}, ${conversationId}`);
                    res.status(200).json({
                        showToast: {
                            text: `Configuration denied - unauthorized subreddit. For more info: r/gamedaylive_dev`,
                        },
                    });
                    return;
                }

                // Read existing config to preserve any previously saved thread settings
                let existingConfig: SubredditConfig | undefined;
                try {
                    existingConfig = await getSubredditConfig(context.subredditName);
                } catch (err) {
                    logger.warn('Failed to fetch existing config during step 1 save', err);
                }

                // Save partial config — preserve existing thread settings if present,
                // otherwise fall back to defaults. Step 2 will overwrite with final values.
                const partialConfig: SubredditConfig = {
                    league: leagueValue,
                    nhl: { teamAbbreviation: teamValue } as NHLConfig,
                    pregame: { ...(existingConfig?.pregame ?? DEFAULT_THREAD), enabled: !!pregameEnabled },
                    gameday: { ...(existingConfig?.gameday ?? DEFAULT_THREAD), enabled: !!gamedayEnabled },
                    postgame: { ...(existingConfig?.postgame ?? DEFAULT_THREAD), enabled: !!postgameEnabled },
                };
                await setSubredditConfig(context.subredditName, partialConfig);

                // Build step 2 fields dynamically based on enabled thread types
                const fields = [];

                if (pregameEnabled) {
                    fields.push(
                        {
                            type: 'boolean',
                            name: 'pregameSticky',
                            label: 'Pre-game: Sticky',
                            defaultValue: partialConfig.pregame.sticky,
                        },
                        {
                            type: 'boolean',
                            name: 'pregameLock',
                            label: 'Pre-game: Lock',
                            defaultValue: partialConfig.pregame.lock,
                        },
                        {
                            type: 'boolean',
                            name: 'pregameSort',
                            label: 'Pre-game: Sort comments by New',
                            defaultValue: partialConfig.pregame.sort === 'new',
                        }
                    );
                }

                if (gamedayEnabled) {
                    fields.push(
                        {
                            type: 'boolean',
                            name: 'gamedaySticky',
                            label: 'Game day: Sticky thread',
                            defaultValue: partialConfig.gameday.sticky,
                        },
                        {
                            type: 'boolean',
                            name: 'gamedayLock',
                            label: 'Game day: Lock thread after game',
                            defaultValue: partialConfig.gameday.lock,
                        },
                        {
                            type: 'boolean',
                            name: 'gamedaySort',
                            label: 'Game day: Sort comments by New (off = Best)',
                            defaultValue: partialConfig.gameday.sort === 'new',
                        }
                    );
                }

                if (postgameEnabled) {
                    fields.push(
                        {
                            type: 'boolean',
                            name: 'postgameSticky',
                            label: 'Post-game: Sticky thread',
                            defaultValue: partialConfig.postgame.sticky,
                        },
                        {
                            type: 'boolean',
                            name: 'postgameLock',
                            label: 'Post-game: Lock thread 18h after post',
                            defaultValue: partialConfig.postgame.lock,
                        },
                        {
                            type: 'boolean',
                            name: 'postgameSort',
                            label: 'Post-game: Sort comments by New (off = Best)',
                            defaultValue: partialConfig.postgame.sort === 'new',
                        }
                    );
                }

                res.json({
                    showForm: {
                        name: 'configStep2Form',
                        form: {
                            title: 'GameDayLive — Step 2 of 2',
                            fields,
                            acceptLabel: 'Save',
                        },
                    },
                });
            } catch (err) {
                logger.error('Error in config step 1:', err);
                res.status(200).json({
                    showToast: {
                        appearance: 'error',
                        text: 'Something went wrong. Please try again.',
                    },
                });
            }
        }
    );
};

// -------- FORM ACTION — Screen 2 → Final save --------

export const formStep2Action = (router: Router): void => {
    router.post(
        '/internal/form/config-step2-form',
        async (req, res): Promise<void> => {
            const logger = await Logger.Create('Form - Config Step 2');

            try {
                // Read the partial config saved in step 1
                const savedConfig = await getSubredditConfig(context.subredditName);
                if (!savedConfig) {
                    res.status(200).json({
                        showToast: {
                            appearance: 'error',
                            text: 'Session expired. Please re-open the config menu.',
                        },
                    });
                    return;
                }

                const {
                    pregameSticky, pregameLock, pregameSort,
                    gamedaySticky, gamedayLock, gamedaySort,
                    postgameSticky, postgameLock, postgameSort,
                } = req.body;

                // Helper to merge step 2 values into a ThreadConfig.
                // If the thread type was disabled in step 1, its fields won't be
                const mergeThreadConfig = (
                    existing: ThreadConfig,
                    sticky: boolean | undefined,
                    lock: boolean | undefined,
                    sortNew: boolean | undefined,
                ): ThreadConfig => {
                    if (!existing.enabled) return existing;
                    return {
                        ...existing,
                        sticky: !!sticky,
                        lock: !!lock,
                        sort: sortNew ? 'new' : 'best',
                    };
                };

                const finalConfig: SubredditConfig = {
                    ...savedConfig,
                    pregame: mergeThreadConfig(savedConfig.pregame, pregameSticky, pregameLock, pregameSort),
                    gameday: mergeThreadConfig(savedConfig.gameday, gamedaySticky, gamedayLock, gamedaySort),
                    postgame: mergeThreadConfig(savedConfig.postgame, postgameSticky, postgameLock, postgameSort),
                };

                await setSubredditConfig(context.subredditName, finalConfig);

                // Verify save
                const verifiedConfig = await getSubredditConfig(context.subredditName);
                const savedTeam = verifiedConfig?.nhl?.teamAbbreviation;
                if (!savedTeam) {
                    logger.error('Team did not persist after final save');
                }

                // Send modmail confirmation
                const conversationId = await sendModmail(
                    getApprovalSubject(),
                    getApprovalBody('NHL', savedTeam ?? 'N/A', finalConfig) // FIX: dynamic league label
                );
                logger.info(`Sent approval modmail to ${context.subredditName}, conversation: ${conversationId}`);

                // -------- DUPLICATE JOB CHECK --------
                try {
                    const prefix = `Game Day Thread`;
                    const jobs: (ScheduledJob | ScheduledCronJob)[] = await scheduler.listJobs();
                    const jobTitles = jobs.map(job => {
                        const data = job.data as { jobTitle?: string };
                        return { label: data?.jobTitle ?? job.id, value: job.id };
                    });

                    const matchingJob = jobTitles.find(j => j.label.includes(prefix));
                    if (matchingJob) {
                        const result = await tryCancelScheduledJob(matchingJob.label);
                        if (result) {
                            logger.info(`Job: ${matchingJob.label} already exists. Overwriting...`);
                        } else {
                            logger.warn(`Existing pending job: ${matchingJob.label} found. Duplicate thread may occur.`);
                        }
                    }
                } catch (err) {
                    logger.error(`Error during duplication check`, err);
                }

                // -------- DAILY GAME SCHEDULER --------
                // HACK:FIX: Determine job to run based on league selection
                await dailyGameCheckJob();

                const teamName = getTeamLabel(savedTeam ?? 'N/A');
                res.status(200).json({
                    showToast: {
                        appearance: 'success',
                        text: `Configuration saved for team: ${teamName}`,
                    },
                });
            } catch (err) {
                logger.error('Error saving subreddit config:', err);
                res.status(200).json({
                    showToast: {
                        appearance: 'error',
                        text: 'Failed to save configuration.',
                    },
                });
            }
        }
    );
};

// -------- MODMAIL HELPERS --------

function getApprovalSubject(): string {
    return `Confirming your GameDayLive configuration settings`;
}

function getApprovalBody(league: string, team: string, config: SubredditConfig): string {
    const fmt = (t: ThreadConfig) => t.enabled
        ? `Enabled | Sticky: ${t.sticky ? 'Yes' : 'No'} | Lock: ${t.lock ? 'Yes' : 'No'} | Sort: ${t.sort}`
        : 'Disabled';

    return `Thank you for using GameDayLive! Here are your saved configuration settings. If anything doesn't look right, simply reconfigure and save.  

League: ${league}  
Team: ${team}  

Pre-game threads:  ${fmt(config.pregame)}  
Game day threads:  ${fmt(config.gameday)}  
Post-game threads: ${fmt(config.postgame)}  

Tip: Some errors that interrupt the bot's functionality may be sent in modmail to notify you.  
If you come across any issues, you can re-save your config form to try to get the bot to recover.  
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