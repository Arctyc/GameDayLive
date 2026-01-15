import { Router } from 'express';
import { context } from '@devvit/web/server';
import { LEAGUES, SubredditConfig } from '../types';
import { NHLConfig } from '../leagues/nhl/types';
import { getTeamsForLeague } from '../leagues';
import { getSubredditConfig, setSubredditConfig } from '../config';
import { getTeamLabel } from '../leagues/nhl/config';
import { APPROVED_NHL_SUBREDDITS } from '../leagues/nhl/config';
import { dailyGameCheckJob } from '../leagues/nhl/jobs';
import { Logger } from '../utils/Logger';

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
                                defaultValue: true,
                            }
                            ],
                            acceptLabel: 'Save',
                        }
                    }
                });
            } catch (error){
                // TODO: handle error
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
                //NOTE:logger.debug(`Attempting to store config for ${context.subredditName}`)
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
                //NOTE:logger.debug(`Attempting to run daily game check...`);
                await dailyGameCheckJob();

                // TODO:FIX: Check for existing scheduled Create Game Thread job (any game ID)
                // If found, cancel the job and remove the redis lock, 1 sub = 1 thread

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