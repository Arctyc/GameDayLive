import { Router } from 'express';
import { context } from '@devvit/web/server';
import { SubredditConfig, NHLConfig } from '../types';
import { setSubredditConfig } from '../config';
//import { Logger } from '../utils/Logger'; // TODO: implement proper logging

export const formAction = (router: Router): void => {
    router.post(
        '/internal/form/config-form',
        async (req, res): Promise<void> => {

            try {
                // Extract form data
                const { league, team, enablePostgameThreads } = req.body;
                
                // Convert arrays to single values if needed
                const leagueValue = Array.isArray(league) ? league[0] : league;
                const teamValue = Array.isArray(team) ? team[0] : team;
                const enablePostgameThreadsValue = Array.isArray(enablePostgameThreads) 
                    ? enablePostgameThreads[0] 
                    : enablePostgameThreads;

                // Build subredditConfig object
                const config: SubredditConfig = {
                    league: leagueValue,
                    enablePostgameThreads: !!enablePostgameThreadsValue,
                    ...(teamValue ? { nhl: { teamAbbreviation: teamValue } as NHLConfig } : {}),                    
                };

                // Store in redis using helper function
                await setSubredditConfig(context.subredditName, config);

                // Send success toast
                res.status(200).json({
                    showToast: {
                        appearance: 'success',
                        text: `Configuration saved for team: ${teamValue || 'N/A'}`
                    }
                });

            } catch (error) {
                // logger.error('Error saving subreddit config:', error); // TODO: implement proper logging
                console.error('Error saving subreddit config:', error);
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