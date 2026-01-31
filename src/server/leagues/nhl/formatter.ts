import { getSubredditConfig } from "../../config";
import { getTeamTimezone } from "./config";
import { GAME_STATES } from "./constants";
import type { NHLGame } from "./api";
import { context } from "@devvit/web/server";

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

    // Format date from startTimeUTC if gameDate doesn't exist
    const gameDate = game.gameDate || startTime.toLocaleDateString('en-CA', {
        timeZone: timezone
    });

    const localTime = startTime.toLocaleTimeString('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
    });
    
    // Build title based on game state
    // HACK: Probably smarter to have a separate PGT function
    if (gameState === GAME_STATES.FINAL || gameState === GAME_STATES.OFF) {
        return `PGT | ${awayTeam} @ ${homeTeam}`;
    } 
    else return `Game Day Thread | ${awayTeam} @ ${homeTeam} | ${gameDate} ${localTime}`;
}

export async function formatThreadBody(game: NHLGame): Promise<string> {
    
    const body = 
        await buildBodyHeader(game, context.subredditName) +
        "\n\n---\n\n" +
        buildBodyGoals(game) +
        "\n\n---\n\n" +
        buildBodyPenalties(game)
    return body;
}

async function buildBodyHeader(game: NHLGame, subredditName: string): Promise<string> {
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

    // Extract officials
    // TODO: If possible, not appearing as part of nhle.com api data

    // Build game status text
    let periodLabel: string;

    if (gameState === GAME_STATES.FINAL) {
        periodLabel = "Final (unofficial)";
    }
    else if (gameState === GAME_STATES.OFF) {
        periodLabel = "Final (official)";
    }
    else if (period === 0) {
        periodLabel = "Scheduled";
    }
    else if (inIntermission) {
        switch (period) {
            case 1:
                periodLabel = "1st Intermission";
                break;
            case 2:
                periodLabel = "2nd Intermission";
                break;
            default:
                periodLabel = "Intermission";
        }
    }
    else if (periodType === "SO") {
        periodLabel = "Shootout";
    }
    else if (periodType === "OT") {
        periodLabel = period === 4 ? "Overtime" : `${period - 3}OT`;
    }
    else {
        periodLabel = `Period ${period}`;
    }

    // Time remaining text
    let timeRemainingDisplay = "";

    if (gameState === GAME_STATES.LIVE || gameState === GAME_STATES.CRIT) {
        timeRemainingDisplay = (periodType === "SO")
            ? "In Progress"
            : rawTimeRemaining;
    }

    // Combine safely
    const combinedStatusText = timeRemainingDisplay
        ? `${periodLabel} - ${timeRemainingDisplay}`
        : periodLabel;

    // Construct GameCenter URL
    const gameCenterUrl = `https://www.nhl.com/gamecenter/${game.id}`;

    const header = `# [${awayTeamPlace} ${awayTeamName} @ ${homeTeamPlace} ${homeTeamName}](${gameCenterUrl})

**Score:** ${awayTeamAbbrev} **${awayScore}** : **${homeScore}** ${homeTeamAbbrev}  
**Status:** ${combinedStatusText}  
**Start Time:** ${localTime} | **Venue:** ${game.venue.default} | **Networks:** ${networks}  
**Last Update:** ${new Date().toLocaleString('en-US', { timeZone: timezone })}
`;
    
    return header;
}

function getPeriodLabel(period: number, game: NHLGame, plays?: any[]): string {
    if (plays && plays.length > 0) {
        const descriptor = plays[0].periodDescriptor;
        const type = descriptor?.periodType;
        if (type === "SO") {
            return "SO";
        } else if (type === "OT") {
            return period === 4 ? "OT" : `${period - 3}OT`;
        }
    } else {
        // Check game state for period label when no plays exist
        if (game.shootoutInUse && period === 5) {
            return "SO";
        } else if (game.otInUse && period >= 4) {
            return period === 4 ? "OT" : `${period - 3}OT`;
        }
    }
    
    return String(period);
}

function isShootoutPeriod(period: number, game: NHLGame, plays?: any[]): boolean {
    if (plays && plays.length > 0) {
        const descriptor = plays[0].periodDescriptor;
        return descriptor?.periodType === "SO";
    }
    return (game.shootoutInUse ?? false) && period === 5;
}

function buildBodyGoals(game: NHLGame): string {
    const currentPeriod = game.periodDescriptor?.number ?? 0;
    
    if (currentPeriod === 0) {
        return "";
    }

    const { goals } = organizePlaysByPeriod(game.plays || []);
    
    let out = `**GOALS** swipe→\n\n`;
    out += buildGoalsTableHeader();
    
    let hasAnyGoals = false;
    
    for (let period = 1; period <= currentPeriod; period++) {
        const sortedPlays = goals[period]?.sort((a, b) => {
            return a.timeInPeriod.localeCompare(b.timeInPeriod);
        });

        if (sortedPlays && sortedPlays.length > 0) {
            hasAnyGoals = true;
            const periodLabel = getPeriodLabel(period, game, sortedPlays);
            for (const play of sortedPlays) {
                out += goalRowFromPlay(play, game, periodLabel);
            }
        }
    }
    
    if (!hasAnyGoals) {
        out += `- | - | - | - | - | - | -\n`;
    }
    
    out += `\n`;
    return out;
}

function buildBodyPenalties(game: NHLGame): string {
    const currentPeriod = game.periodDescriptor?.number ?? 0;
    
    if (currentPeriod === 0) {
        return "";
    }

    const { penalties } = organizePlaysByPeriod(game.plays || []);
    
    let out = `**PENALTIES** swipe→\n\n`;
    out += buildPenaltiesTableHeader();
    
    let hasAnyPenalties = false;
    
    for (let period = 1; period <= currentPeriod; period++) {
        // Skip shootout periods entirely for penalties
        if (isShootoutPeriod(period, game, penalties[period])) continue;
        
        const sortedPlays = penalties[period]?.sort((a, b) => {
            return a.timeInPeriod.localeCompare(b.timeInPeriod);
        });

        if (sortedPlays && sortedPlays.length > 0) {
            hasAnyPenalties = true;
            const periodLabel = getPeriodLabel(period, game, sortedPlays);
            for (const play of sortedPlays) {
                out += penaltyRowFromPlay(play, game, periodLabel);
            }
        }
    }
    
    if (!hasAnyPenalties) {
        out += `- | - | - | - | - | - | -\n`;
    }
    
    out += `\n`;
    return out;
}

function buildGoalsTableHeader() {
    return (
`| Per. | Time | Team | Player | Shot&nbsp;Type | Assists | Clip |
|---|---|---|--------|--------|--------|---|
`);
}

function buildPenaltiesTableHeader() {
    return (
`| Per. | Time | Team | Player | Infraction | Against | Min. |
|---|---|---|--------|--------|--------|---|
`);
}


function goalRowFromPlay(play: any, game: NHLGame, periodLabel: string): string { 
    const d = play.details;
    if (!d) return ""; // Skip plays with no goals
    const time = formatTime(play.timeInPeriod);
    const team = getTeamById(game, d.eventOwnerTeamId);

    const scorer = getPlayerInfo(game, d.scoringPlayerId);
    if (!scorer) return "";

    let shotType: string = (d.shotType ?? "Unknown")
        .toLowerCase()
        .replace(/\b\w/g, (c: string) => c.toUpperCase()
    );

    // Format shot type
    if (shotType == "Slap" || shotType == "Snap" || shotType == "Wrist" ) {
        shotType += "&nbsp;shot";
    }
    
    // Add strength modifier (EV, PP, SH)
    let scoringTeam: 'home' | 'away';
    if (team === game.homeTeam.abbrev) {
        scoringTeam = 'home';
    } else {
        scoringTeam = 'away';
    }
    const modifier = getStrength(play.situationCode, scoringTeam);

    const assists: string[] = [];

    const a1 = getPlayerInfo(game, d.assist1PlayerId);
    if (a1) assists.push(`#${a1.number} ${a1.name}`);

    const a2 = getPlayerInfo(game, d.assist2PlayerId);
    if (a2) assists.push(`#${a2.number} ${a2.name}`);

    const assistsStr = assists.length ? assists.join(", ") : "Unassisted";

    const clip = d.highlightClipSharingUrl 
        ? `[nhl.com](${d.highlightClipSharingUrl})` 
        : "-";

    return `| ${periodLabel} | ${time} | ${team} | #${scorer.number} ${scorer.name} | ${shotType}&nbsp;${modifier} | ${assistsStr} | ${clip}\n`;
}

function penaltyRowFromPlay(play: any, game: NHLGame, periodLabel: string): string {
    const d = play.details;
    if (!d || play.typeDescKey !== 'penalty') return "";

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

    const infraction = formatInfraction(d.descKey);    
    
    const minutes = d.duration ?? 0;

    return `${periodLabel} | ${time} | ${team} | ${playerStr} | ${infraction} | ${againstStr} | ${minutes}\n`;
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
    if (!t || !t.includes(":")) return "-";
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

function getStrength(
    situationCode: string,
    scoringTeam: 'home' | 'away'
): string {

    if (!/^\d{4}$/.test(situationCode)) { return ""; }

    if (situationCode === "0101" || situationCode === "1010"){ return ""; } // Shootout

    const [awayGoalie, awaySkaters, homeSkaters, homeGoalie] =
        situationCode.split("").map(Number) as [number, number, number, number];

    const scoringIsHome = scoringTeam === 'home';

    const teamSkaters = scoringIsHome ? homeSkaters : awaySkaters;
    const oppSkaters  = scoringIsHome ? awaySkaters : homeSkaters;

    const teamGoalieInNet = scoringIsHome ? homeGoalie : awayGoalie;
    const oppGoalieInNet  = scoringIsHome ? awayGoalie : homeGoalie;

    if (oppGoalieInNet === 0) return "ENG";
    if (teamSkaters > oppSkaters) return "PP";
    if (teamSkaters < oppSkaters) return "SHG";
    if (teamSkaters > oppSkaters && !teamGoalieInNet) return "EA";
    return "";
}

// Manually override any annoyingly long strings, or calls that should have spaces instead of hyphens
function formatInfraction(descKey: string | undefined): string {
    const s = descKey ?? "Penalty";

    switch (s) {
        case "too-many-men-on-the-ice":
        return "Too&nbsp;Many&nbsp;Men";

        case "delaying-game-puck-over-glass":
        return "DoG Puck Over Glass";

        case "delaying-game-unsuccessful-challenge":
            return "DoG Unsuccessful Challenge";
        
        case "abuse-of-officials":
            return "Abuse&nbsp;of&nbsp;Officials";

        case "unsportsmanlike-conduct":
            return "Unsportsmanlike Conduct";

        case "holding-the-stick":
            return "Holding&nbsp;the&nbsp;Stick";

        case "roughing-removing-opponents-helmet":
            return "Roughing (Remove opp. helmet)";

        case "high-sticking-double-minor":
            return "High-sticking";

        case "interference-goalkeeper":
            return "Goalkeeper&nbsp;Interference";
        
        case "goalie-leave-crease":
            return "Leaving&nbsp;the&nbsp;Crease";
        
        case "illegal-check-to-head":
            return "Illegal&nbsp;Check&nbsp;to&nbsp;Head";
        
        default: // Returns capitalized first letter
            return s.charAt(0).toUpperCase() + s.slice(1);
    }
}