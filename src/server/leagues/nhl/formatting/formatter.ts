import { getSubredditConfig } from "../../../config";
import { getTeamTimezone } from "../config";
import { GAME_STATES } from "../constants";
import type { NHLGame } from "../api";
import { context } from "@devvit/web/server";
import { buildBodyHeader } from "./formatHeader";
import { buildBodyLinescore } from "./formatLinescore";
import { buildBodyGoals } from "./formatGoals";
import { buildBodyPenalties } from "./formatPenalties";

export async function formatThreadTitle(game: NHLGame): Promise<string> {
    const homeTeam = game.homeTeam.abbrev;
    const awayTeam = game.awayTeam.abbrev;
    const gameState = game.gameState ?? GAME_STATES.UNKNOWN;
    const subredditName = context.subredditName;

    // Determine time zone
    const config = await getSubredditConfig(subredditName);
    const teamAbbrev = config!.nhl!.teamAbbreviation;
    const timezone = getTeamTimezone(teamAbbrev)!;

    // Format start time to team's local timezone
    const startTime = new Date(game.startTimeUTC);

    const gameDate = game.gameDate || startTime.toLocaleDateString('en-CA', {
        timeZone: timezone
    });

    const localTime = startTime.toLocaleTimeString('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
    });

    // HACK: Probably smarter to have a separate PGT function
    if (gameState === GAME_STATES.FINAL || gameState === GAME_STATES.OFF) {
        return `PGT | ${awayTeam} @ ${homeTeam}`;
    }
    return `Game Day Thread | ${awayTeam} @ ${homeTeam} | ${gameDate} ${localTime}`;
}

export async function formatThreadBody(game: NHLGame): Promise<string> {
    const subredditName = context.subredditName;
    const gameState = game.gameState ?? GAME_STATES.UNKNOWN;

    const header = await buildBodyHeader(game, subredditName);

    if (gameState === GAME_STATES.FUT || gameState === GAME_STATES.PRE) {
        return header;
    }

    return (
        header +
        "\n\n---\n\n" +
        buildBodyLinescore(game) +
        "\n\n---\n\n" +
        buildBodyGoals(game) +
        "\n\n---\n\n" +
        buildBodyPenalties(game)
    );
}