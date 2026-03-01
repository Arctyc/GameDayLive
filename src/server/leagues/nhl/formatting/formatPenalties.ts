import type { NHLGame } from "../api";
import {
    organizePlaysByPeriod,
    getPeriodLabel,
    isShootoutPeriod,
    getTeamById,
    getPlayerInfo,
    formatTime,
    formatInfraction,
} from "./helpers";

export function buildBodyPenalties(game: NHLGame): string {
    const currentPeriod = game.periodDescriptor?.number ?? 0;

    if (currentPeriod === 0) return "";

    const { penalties } = organizePlaysByPeriod(game.plays || []);

    let out = `**PENALTIES** swipe→\n\n`;
    out += buildPenaltiesTableHeader();

    let hasAnyPenalties = false;

    for (let period = 1; period <= currentPeriod; period++) {
        // Skip shootout periods entirely for penalties
        if (isShootoutPeriod(period, game, penalties[period])) continue;

        const sortedPlays = penalties[period]?.sort((a, b) =>
            a.timeInPeriod.localeCompare(b.timeInPeriod)
        );

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

function buildPenaltiesTableHeader(): string {
    return (
`| Per. | Time | Team | Player | Infraction | Against | Min. |
|---|---|---|--------|--------|--------|---|
`);
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