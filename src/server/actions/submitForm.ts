import { Router } from 'express';
import { context } from '@devvit/web/server';
import { SubredditConfig, NHLConfig } from '../types';
import { getTeamLabel } from '../leagues/nhl/config';
import { getSubredditConfig, setSubredditConfig } from '../config';
import { dailyGameCheckJob } from '../leagues/nhl/jobs';
import { Logger } from '../utils/Logger';
import { APPROVED_NHL_SUBREDDITS } from '../leagues/nhl/config';

export const formAction = (router: Router): void => {
    router.post(
        '/internal/form/config-form',
        async (req, res): Promise<void> => {
            const logger = await Logger.Create('Form - Config');

            try {
                // Extract form data
                const { league, team, enablePostgameThreads } = req.body;
                                
                // Convert arrays to single values if needed
                const leagueValue = Array.isArray(league) ? league[0] : league;
                const teamValue = Array.isArray(team) ? team[0] : team;
                const enablePostgameThreadsValue = Array.isArray(enablePostgameThreads) 
                    ? enablePostgameThreads[0] 
                    : enablePostgameThreads;

                // Don't allow empty selection for league or team
                if (!leagueValue || !teamValue) {
                    res.status(400).json({
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
                const subreddit = context.subredditName?.toLowerCase();

                if ( !subreddit || !APPROVED_NHL_SUBREDDITS.some(s => s.toLowerCase() === subreddit.toLowerCase())) {
                    logger.warn(`Unauthorized subreddit attempted config: ${subreddit}`);

                    res.status(200).json({
                        showToast: {
                            text: `Configuration denied - unauthorized subreddit. For more info: r/gamedaylive_dev`
                        }
                    });
                    return;
                }

                // ---- CONFIG ----

                // Build subredditConfig object
                const config: SubredditConfig = {
                    league: leagueValue,
                    enablePostgameThreads: !!enablePostgameThreadsValue,
                    ...(teamValue ? { nhl: { teamAbbreviation: teamValue } as NHLConfig } : {}),                    
                };

                // Store in redis using helper function
                logger.debug(`Attempting to store config for ${context.subredditName}`)
                await setSubredditConfig(context.subredditName, config);

                // Pull saved team name to confirm with toast
                const savedConfig = await getSubredditConfig(context.subredditName)
                let savedTeamValue = savedConfig?.nhl?.teamAbbreviation;
                if (!savedTeamValue){
                    logger.error(`Team did not save in config`);
                    savedTeamValue = "N/A";
                }
                // ---- END CONFIG ----

                // Run daily game check immediately
                // TODO:FIX: Determine job to run based on league selection
                logger.debug(`Attempting to run daily game check...`);
                await dailyGameCheckJob();

                // Send success toast
                const teamName = getTeamLabel(savedTeamValue);
                res.status(200).json({
                    showToast: {
                        appearance: 'success',
                        text: `Configuration saved for team: ${teamName}`
                    }
                });

            } catch (error) {
                logger.error('Error saving subreddit config:', error);
                res.status(400).json({
                    showToast: {
                        appearance: 'error',
                        text: `Failed to save configuration.`
                    }
                });
            }
        }
    );
};