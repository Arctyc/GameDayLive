import { Router } from 'express';
import { context } from '@devvit/web/server';
import { SubredditConfig, NHLConfig } from '../types';
import { setSubredditConfig, getSubredditConfig } from '../config';
import { dailyGameCheckJob } from '../leagues/nhl/jobs';
import { Logger } from '../utils/Logger';

export const formAction = (router: Router): void => {
    router.post(
        '/internal/form/config-form',
        async (req, res): Promise<void> => {
            const logger = await Logger.Create('Form - Config');

            try {
                // Extract form data
                const { league, team, enablePostgameThreads } = req.body;

                // FIX: Don't allow N/A team or league
                
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
                logger.debug(`Attempting to store config for ${context.subredditName}`)
                await setSubredditConfig(context.subredditName, config);

                // DEBUG: Read back the config from Redis and log it
                try {
                    const savedConfig = await getSubredditConfig(context.subredditName!);
                    if (savedConfig) {
                        logger.info('Config retrieved from Redis after save:', savedConfig);
                    } else {
                        logger.warn('No config found in Redis after save!');
                    }
                } catch (err) {
                    logger.error('Error retrieving config from Redis after save:', err);
                }
                
                // Run daily game check immediately
                // TODO:FIX: Determine job to run based on league selection
                logger.debug(`Attempting to run daily game check...`);
                await dailyGameCheckJob(context.subredditName!);

                // Send success toast
                res.status(200).json({
                    showToast: {
                        appearance: 'success',
                        text: `Configuration saved for team: ${teamValue || 'N/A'}`
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