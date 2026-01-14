import { Router } from 'express';
import { LEAGUES, SubredditConfig } from '../types';
import { NHL_TEAMS } from '../leagues/nhl/config';
import { getTeamsForLeague } from '../leagues';
import { getSubredditConfig } from '../config';
import { context } from '@devvit/web/server';
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
                const defaultLeague = config?.league ?? LEAGUES[0];
                const teamsForLeague = getTeamsForLeague(defaultLeague) ?? [];
                const defaultTeam = config?.nhl?.teamAbbreviation ?? teamsForLeague?.[0]?.value ?? '';

                // Build form
                res.json({
                    showForm: {
                        name: 'subredditConfigForm',
                        form: {
                            title: 'GameDayLive Configuration',
                            initialValues: {
                                league: defaultLeague,
                                team: defaultTeam,
                                enablePostgameThreads: config?.enablePostgameThreads ?? true,
                            },
                            fields: [
                            {
                                type: 'select',
                                name: 'league',
                                label: 'League',
                                options: LEAGUES.map((l: typeof LEAGUES[number]) => ({
                                label: l.toUpperCase(),
                                value: l
                                })),
                                onValueChanged: 'refresh',
                                required: true,
                            },
                            {
                                type: 'select',
                                name: 'team',
                                label: 'Team',
                                options: teamsForLeague,
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