import { Router } from "express";
import { LEAGUES } from "../types";
import { NHL_TEAMS } from "../leagues/nhl/config";
// TODO: implement proper logging

export const menuAction = (router: Router): void => {
    router.post(
        '/internal/menu/config-menu',
        async (_req, res): Promise<void> => {

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
                                defaultValue: LEAGUES[0],
                                onValueChanged: 'refresh',
                            },
                            {
                                type: 'select',
                                name: 'team',
                                label: 'Team',
                                options: NHL_TEAMS, // FIX: Dynamic teams based on league
                                defaultValue: NHL_TEAMS[0],
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