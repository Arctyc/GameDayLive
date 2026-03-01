import type { NHLGame } from "../api";
import {
    organizePlaysByPeriod,
    getPeriodLabel,
    getTeamById,
    getPlayerInfo,
    getStrength,
    formatTime,
} from "./helpers";

export function buildBodyGoals(game: NHLGame): string {
    const currentPeriod = game.periodDescriptor?.number ?? 0;

    if (currentPeriod === 0) return "";

    const { goals } = organizePlaysByPeriod(game.plays || []);

    let out = `**GOALS** swipe→\n\n`;
    out += buildGoalsTableHeader();

    let hasAnyGoals = false;

    for (let period = 1; period <= currentPeriod; period++) {
        const sortedPlays = goals[period]?.sort((a, b) =>
            a.timeInPeriod.localeCompare(b.timeInPeriod)
        );

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

function buildGoalsTableHeader(): string {
    return (
`| Per. | Time | Team | Player | Shot&nbsp;Type | Assists | Clip |
|---|---|---|--------|--------|--------|---|
`);
}

function goalRowFromPlay(play: any, game: NHLGame, periodLabel: string): string {
    const d = play.details;
    if (!d) return "";

    const time = formatTime(play.timeInPeriod);
    const team = getTeamById(game, d.eventOwnerTeamId);

    const scorer = getPlayerInfo(game, d.scoringPlayerId);
    if (!scorer) return "";

    let shotType: string = (d.shotType ?? "Unknown")
        .toLowerCase()
        .replace(/\b\w/g, (c: string) => c.toUpperCase());

    if (shotType === "Slap" || shotType === "Snap" || shotType === "Wrist") {
        shotType += "&nbsp;shot";
    }

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