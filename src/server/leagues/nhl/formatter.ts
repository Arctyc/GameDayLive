import { getSubredditConfig } from "../../config";
import { getTeamTimezone } from "./config";
import { GAME_STATES } from "./constants";
import type { NHLGame } from "./api";
import { Logger } from '../../utils/Logger';

export async function formatThreadTitle(game: NHLGame, subredditName: string): Promise<string> {
    const logger = await Logger.Create('Format - Thread Title'); // TODO: Implement logging
    
    const homeTeam = game.homeTeam.abbrev;
    const awayTeam = game.awayTeam.abbrev;
    const gameState = game.gameState ?? GAME_STATES.UNKNOWN;
    
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
    
    // Build title based on game state
    if (gameState === GAME_STATES.FINAL || gameState === GAME_STATES.OFF) {
        return `PGT | ${awayTeam} @ ${homeTeam} | ${localTime}`;
    } 
    else return `Game Day Thread | ${awayTeam} @ ${homeTeam} | ${game.gameDate} ${localTime}`;
}

export async function formatThreadBody(game: NHLGame, subredditName: string): Promise<string> {
    const logger = await Logger.Create('Format - Thread Body'); // TODO: Implement logging
    
    const body = 
        await buildBodyHeader(game, subredditName) +
        "\n\n---\n\n" +
        buildBodyGoals(game) +
        "\n\n---\n\n" +
        buildBodyPenalties(game) +
        "\n\n---\n\n" +
        buildBodyFooter();
    return body;
}

async function buildBodyHeader(game: NHLGame, subredditName: string): Promise<string> {
    const logger = await Logger.Create('Format - Body Header'); // TODO: Implement logging
    
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
    let statusText = gameState;
    if (gameState === GAME_STATES.LIVE || gameState === GAME_STATES.CRIT) {
        // Check if in intermission
        const inIntermission = game.clock?.inIntermission ?? false;
        
        if (inIntermission) {
            if (period === 1) {
                statusText = "First Intermission";
            } else if (period === 2) {
                statusText = "Second Intermission";
            } else {
                statusText = `Intermission`;
            }
        } else {
            // Active play
            const timeRemaining = game.clock?.timeRemaining ?? "";
            
            if (periodType === "OT") {
                statusText = `Overtime - ${timeRemaining}`;
            } else if (periodType === "SO") {
                statusText = "Shootout";
            } else {
                statusText = `Period ${period} - ${timeRemaining}`;
            }
        }
    } else if (gameState === GAME_STATES.FINAL || gameState === GAME_STATES.OFF) {
        statusText = "Final";
    } else if (gameState === "FUT" || gameState === "PRE") {
        statusText = "Scheduled";
    }
    
    const header = `# ${awayTeamPlace} ${awayTeamName} @ ${homeTeamPlace} ${homeTeamName}

**Networks:** ${networks}
**Status:** ${statusText}  
**Score:** ${awayTeamAbbrev} ${awayScore}, ${homeTeamAbbrev} ${homeScore}  
**Start Time:** ${localTime}  
**Venue:** ${game.venue.default}  
**Last Update:** ${new Date().toLocaleString('en-US', { timeZone: timezone })}
`;
    
    return header;
}

function buildBodyGoals(game: NHLGame): string {
    if (!game.plays || game.plays.length === 0) {
        return "# GOALS\n\nNo goals scored yet.";
    }

    const { goals } = organizePlaysByPeriod(game.plays);

    if (Object.keys(goals).length === 0) {
        return "# GOALS\n\nNo goals scored yet.";
    }

    let out = `# GOALS\n\n`;

    for (const period of Object.keys(goals).map(Number).sort((a, b) => a - b)) {
        const sortedPlays = goals[period]?.sort((a, b) => {
            return a.timeInPeriod.localeCompare(b.timeInPeriod);
        });
        if (!sortedPlays || sortedPlays.length === 0) continue;

        out += `**Period ${period}**\n\n`;
        out += makeGoalsTableHeader();

        for (const play of sortedPlays) {
            out += goalRowFromPlay(play, game);
        }

        out += `\n`;
    }

    return out;
}

function buildBodyPenalties(game: NHLGame): string {
    if (!game.plays || game.plays.length === 0) {
        return "# PENALTIES\n\nNo penalties.";
    }

    const { penalties } = organizePlaysByPeriod(game.plays);

    if (Object.keys(penalties).length === 0) {
        return "# PENALTIES\n\nNo penalties.";
    }

    let out = `# PENALTIES\n\n`;

    const periods = Object.keys(penalties).map(Number).sort((a, b) => a - b);

    for (const period of periods) {
        const sortedPlays = penalties[period]?.sort((a, b) => {
            // Sort chronologically
            return a.timeInPeriod.localeCompare(b.timeInPeriod);
        });
        if (!sortedPlays || sortedPlays.length === 0) continue;

        out += `**Period ${period}**\n\n`;
        out += makePenaltiesTableHeader();

        for (const play of sortedPlays) {
            out += penaltyRowFromPlay(play, game);
        }

        out += `\n`;
    }

    return out;
}

function buildBodyFooter(){
    return "[GameDayLive](https://github.com/Arctyc/GameDayLive) is an open source project.";
}

function makeGoalsTableHeader() {
    return (
`Time | Team | Player | Shot Type | Assists | Clip
---|---|---|---|---|---
`);
}

function makePenaltiesTableHeader() {
    return (
`Time | Team | Player | Infraction | Against | Minutes
---|---|---|---|---|---
`);
}

function goalRowFromPlay(play: any, game: NHLGame): string {
    const d = play.details;
    if (!d) return ""; // Skip plays with no goals
    const time = formatTime(play.timeInPeriod);
    const team = getTeamById(game, d.eventOwnerTeamId);

    const scorer = getPlayerInfo(game, d.scoringPlayerId);
    if (!scorer) return "";

    const shotType = (d.shotType ?? "Unknown")
        .replace("-", " ")
        .toLowerCase()
        .replace(/\b\w/g, (c: string) => c.toUpperCase());
    
    // Add strength modifier (EV, PP, SH)
    const modifier = d.strength ? ` (${d.strength.toUpperCase()})` : "";

    const assists: string[] = [];

    const a1 = getPlayerInfo(game, d.assist1PlayerId);
    if (a1) assists.push(`#${a1.number} ${a1.name}`);

    const a2 = getPlayerInfo(game, d.assist2PlayerId);
    if (a2) assists.push(`#${a2.number} ${a2.name}`);

    const assistsStr = assists.length ? assists.join(", ") : "Unassisted";

    return `${time} | ${team} | #${scorer.number} ${scorer.name}${modifier} | ${shotType} | ${assistsStr}\n`;
}

function penaltyRowFromPlay(play: any, game: NHLGame): string {
    const d = play.details;
    if (!d) return ""; // Skip plays with no penalties
    const time = formatTime(play.timeInPeriod);
    const team = getTeamById(game, d.eventOwnerTeamId);

    const committed = getPlayerInfo(game, d.committedByPlayerId);
    const drawn = getPlayerInfo(game, d.drawnByPlayerId);

    const playerStr = committed
        ? `#${committed.number} ${committed.name}`
        : "Team";

    const againstStr = drawn
        ? `#${drawn.number} ${drawn.name}`
        : "—";

    const infraction = (d.descKey ?? "Penalty")
        .split('-')
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    
    const minutes = d.duration ?? 0;

    return `${time} | ${team} | ${playerStr} | ${infraction} | ${againstStr} | ${minutes}\n`;
}

function getTeamById(game: NHLGame, teamId: number): string {
    if (game.homeTeam.id === teamId) return game.homeTeam.abbrev;
    if (game.awayTeam.id === teamId) return game.awayTeam.abbrev;
    return "UNK";
}

function getPlayerInfo(game: NHLGame, playerId?: number) {
    if (!playerId) return null;
    const p = game.rosterSpots?.find((r: any) => r.playerId === playerId);
    if (!p) return { number: "00", name: "Unknown Player" };
    return {
        number: String(p.sweaterNumber ?? "00"),
        name: `${p.firstName.default} ${p.lastName.default}`
    };
}

function formatTime(t: string): string {
    if (!t || !t.includes(":")) return "00:00";
    const [m, s] = t.split(":").map(Number);
    return `${m!.toString().padStart(2, "0")}:${s!.toString().padStart(2, "0")}`;
}

function organizePlaysByPeriod(plays: any[]) {
    const goals: Record<number, any[]> = {};
    const penalties: Record<number, any[]> = {};

    for (const play of plays) {
        const period = play.periodDescriptor?.number ?? 1;
        const type = play.typeDescKey;

        if (type === "goal") {
            if (!goals[period]) goals[period] = [];
            goals[period]!.push(play);
        }

        if (type === "penalty") {
            if (!penalties[period]) penalties[period] = [];
            penalties[period]!.push(play);
        }
    }

    return { goals, penalties };
}