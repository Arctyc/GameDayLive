import { getSubredditConfig } from "../../../config";
import { getTeamTimezone } from "../config";
import { GAME_STATES } from "../constants";
import type { NHLGame } from "../api";

export async function buildBodyHeader(game: NHLGame, subredditName: string): Promise<string> {
    const homeTeamAbbrev = game.homeTeam.abbrev;
    const awayTeamAbbrev = game.awayTeam.abbrev;
    const homeTeamPlace = game.homeTeam.placeName.default;
    const awayTeamPlace = game.awayTeam.placeName.default;
    const homeTeamName = game.homeTeam.commonName.default;
    const awayTeamName = game.awayTeam.commonName.default;
    const homeScore = game.homeTeam.score ?? 0;
    const awayScore = game.awayTeam.score ?? 0;

    const gameState = game.gameState ?? GAME_STATES.UNKNOWN;
    const period = game.periodDescriptor?.number ?? 0;
    const periodType = game.periodDescriptor?.periodType ?? "";
    const inIntermission = game.clock?.inIntermission ?? false;
    const rawTimeRemaining = game.clock?.timeRemaining ?? "";

    // Determine time zone
    const config = await getSubredditConfig(subredditName);
    const teamAbbrev = config!.nhl!.teamAbbreviation;
    const timezone = getTeamTimezone(teamAbbrev)!;

    // Format start time to team's local timezone
    const startTime = new Date(game.startTimeUTC);
    const localTime = startTime.toLocaleTimeString('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
    });

    // Extract Networks
    const networks = game.tvBroadcasts && game.tvBroadcasts.length > 0
        ? game.tvBroadcasts.map(b => b.network).join(", ")
        : "None?";

    // Build game status text
    let periodLabel: string;

    if (gameState === GAME_STATES.FINAL) {
        periodLabel = "Final (unofficial)";
    } else if (gameState === GAME_STATES.OFF) {
        periodLabel = "Final (official)";
    } else if (period === 0) {
        periodLabel = "Scheduled";
    } else if (inIntermission) {
        switch (period) {
            case 1:  periodLabel = "1st Intermission"; break;
            case 2:  periodLabel = "2nd Intermission"; break;
            default: periodLabel = "Intermission";
        }
    } else if (periodType === "SO") {
        periodLabel = "Shootout";
    } else if (periodType === "OT") {
        periodLabel = period === 4 ? "Overtime" : `${period - 3}OT`;
    } else {
        periodLabel = `Period ${period}`;
    }

    // Time remaining text
    let timeRemainingDisplay = "";
    if (gameState === GAME_STATES.LIVE || gameState === GAME_STATES.CRIT) {
        timeRemainingDisplay = periodType === "SO" ? "In Progress" : rawTimeRemaining;
    }

    const combinedStatusText = timeRemainingDisplay
        ? `${periodLabel} - ${timeRemainingDisplay}`
        : periodLabel;

    const gameCenterUrl = `https://www.nhl.com/gamecenter/${game.id}`;

    return `# [${awayTeamPlace} ${awayTeamName} @ ${homeTeamPlace} ${homeTeamName}](${gameCenterUrl})

**Score:** ${awayTeamAbbrev} **${awayScore}** : **${homeScore}** ${homeTeamAbbrev}  
**Status:** ${combinedStatusText}  
**Start Time:** ${localTime} | **Venue:** ${game.venue.default} | **Networks:** ${networks}  
**Last Update:** ${new Date().toLocaleString('en-US', { timeZone: timezone })}
`;
}