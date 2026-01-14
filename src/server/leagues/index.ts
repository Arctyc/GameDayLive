import { LEAGUES } from "../types";
import { NHL_TEAMS } from "./nhl/config";

export function getTeamsForLeague(league: typeof LEAGUES[number]) {
    switch (league) {
        case 'nhl':
            return NHL_TEAMS;
        // future leagues:
        // case 'nba':
        //     return NBA_TEAMS;
        default:
            return [];
    }
}