import { Router } from 'express';
import { redis, context } from '@devvit/web/server';
import { SubredditConfig, NHLConfig } from '../types';
//import { Logger } from '../utils/Logger'; // TODO: implement proper logging

export const formAction = (router: Router): void => {
    router.post(
        '/internal/form/config-form',
        async (req, res): Promise<void> => {

            try {
                // Extract form data
                
                const { league, team, enablePostgameThreads } = req.body;

                // Build subredditConfig object
                const config: SubredditConfig = {
                    league,
                    enablePostgameThreads: !!enablePostgameThreads,
                    ...(team ? { nhl: { teamAbbreviation: team } as NHLConfig } : {}),                    
                };

                // Prepare redis object
                const key = `subreddit:${context.subredditName}`;
                const fields: Record<string, string> = {
                    league: config.league,
                    enablePostgameThreads: config.enablePostgameThreads.toString(),
                };
                if (config.nhl) fields.nhl = JSON.stringify(config.nhl);

                // Store in redis
                await redis.hSet(key, fields);

                // Send success toast
                res.status(200).json({
                showToast: {
                    appearance: 'success',
                    text: `Configuration saved for team: ${team}`
                }
                });

            } catch (error) {
                // logger.error('Error saving subreddit config:', error); // TODO: implement proper logging
                res.status(400).json({
                showToast: {
                    appearance: 'error',
                    text: `Failed to save configuration. Please report this bug.`
                }
                });
            }
        }
    );
};
