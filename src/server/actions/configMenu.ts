import { Router } from 'express';
import { LEAGUES } from '../types';
import { NHL_TEAMS } from '../leagues/nhl/config';
import { Logger } from '../utils/Logger';

export const menuAction = (router: Router): void => {
    router.post(
        '/internal/menu/config-menu',
        async (_req, res): Promise<void> => {
            const logger = await Logger.Create('Menu - Config'); // TODO: Implement logging

            // Build form
            try {
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
                                defaultValue: LEAGUES[0], // FIX: doesn't set a default // TODO: Default to subredditConfig value if exists
                                onValueChanged: 'refresh',
                            },
                            {
                                type: 'select',
                                name: 'team',
                                label: 'Team',
                                options: NHL_TEAMS, // FIX: Dynamic teams based on league
                                defaultValue: NHL_TEAMS[0], // FIX: doesn't set a default // TODO: Default to subredditConfig value if exists
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