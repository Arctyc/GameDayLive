import type { NHLGame } from "../api";
import { organizePlaysByPeriod, isShootoutPeriod, getPeriodLabel } from "./helpers";

interface TeamLinescoreStats {
    periodGoals: Record<number, number>;
    totalGoals: number;
    shots: number;
    faceoffWins: number;
    faceoffTotal: number;
    blocks: number;
    hits: number;
}

function buildLinescoreStats(game: NHLGame): { away: TeamLinescoreStats; home: TeamLinescoreStats } {
    const plays = game.plays ?? [];
    const { goals } = organizePlaysByPeriod(plays);
    const currentPeriod = game.periodDescriptor?.number ?? 0;

    const homeId = game.homeTeam.id;
    const awayId = game.awayTeam.id;

    // Tally faceoffs, blocks, hits from play-by-play
    let homeFaceoffWins = 0, awayFaceoffWins = 0, totalFaceoffs = 0;
    let homeBlocks = 0, awayBlocks = 0;
    let homeHits = 0, awayHits = 0;

    for (const play of plays) {
        const d = play.details;
        if (!d) continue;

        switch (play.typeDescKey) {
            case "faceoff":
                // eventOwnerTeamId is the winning team
                totalFaceoffs++;
                if (d.eventOwnerTeamId === homeId) homeFaceoffWins++;
                else if (d.eventOwnerTeamId === awayId) awayFaceoffWins++;
                break;

            case "blocked-shot":
                // eventOwnerTeamId is the blocking (defending) team
                if (d.eventOwnerTeamId === homeId) homeBlocks++;
                else if (d.eventOwnerTeamId === awayId) awayBlocks++;
                break;

            case "hit":
                // eventOwnerTeamId is the hitting team
                if (d.eventOwnerTeamId === homeId) homeHits++;
                else if (d.eventOwnerTeamId === awayId) awayHits++;
                break;
        }

    }

    const buildStats = (side: 'away' | 'home'): TeamLinescoreStats => {
        const teamId = side === 'home' ? homeId : awayId;

        const periodGoals: Record<number, number> = {};
        for (let p = 1; p <= currentPeriod; p++) {
            const periodPlays = goals[p] ?? [];
            periodGoals[p] = periodPlays.filter(
                play => play.details?.eventOwnerTeamId === teamId
            ).length;
        }

        const totalGoals = side === 'home'
            ? (game.homeTeam.score ?? 0)
            : (game.awayTeam.score ?? 0);

        const shots = side === 'home'
            ? (game.homeTeam.sog ?? 0)
            : (game.awayTeam.sog ?? 0);

        const faceoffWins  = side === 'home' ? homeFaceoffWins  : awayFaceoffWins;
        const blocks       = side === 'home' ? homeBlocks        : awayBlocks;
        const hits         = side === 'home' ? homeHits          : awayHits;

        return { periodGoals, totalGoals, shots, faceoffWins, faceoffTotal: totalFaceoffs, blocks, hits };
    };

    return { away: buildStats('away'), home: buildStats('home') };
}

function formatFaceoffPct(wins: number, total: number): string {
    if (total === 0) return "-";
    return `${((wins / total) * 100).toFixed(1)}%`;
}

export function buildBodyLinescore(game: NHLGame): string {
    const currentPeriod = game.periodDescriptor?.number ?? 0;
    if (currentPeriod === 0) return "";

    const { away, home } = buildLinescoreStats(game);
    const plays = game.plays ?? [];
    const { goals } = organizePlaysByPeriod(plays);

    // Always show 1–3, add OT/SO columns only if the game went there
    const periodColumns: Array<{ label: string; period: number }> = [
        { label: "1st", period: 1 },
        { label: "2nd", period: 2 },
        { label: "3rd", period: 3 },
    ];

    for (let p = 4; p <= currentPeriod; p++) {
        const playsInPeriod = goals[p] ?? [];
        const label = getPeriodLabel(p, game, playsInPeriod.length > 0 ? playsInPeriod : undefined);
        periodColumns.push({ label, period: p });
    }

    // Header and separator — always include all stat columns
    const periodHeaders = periodColumns.map(c => c.label).join(" | ");
    const header = `| Team | Score | ${periodHeaders} | SOG | F/O% | BLK | HIT |`;
    const separator = `|${Array(periodColumns.length + 6).fill("---").join("|")}|`;

    const buildRow = (abbrev: string, stats: TeamLinescoreStats): string => {
        const periodCells = periodColumns.map(c => {
            const periodPlays = goals[c.period] ?? [];
            if (isShootoutPeriod(c.period, game, periodPlays.length > 0 ? periodPlays : undefined)) {
                return "-";
            }
            return String(stats.periodGoals[c.period] ?? 0);
        });

        const fo  = formatFaceoffPct(stats.faceoffWins, stats.faceoffTotal);
        const blk = stats.blocks || "-";
        const hit = stats.hits   || "-";

        return `| **${abbrev}** | **${stats.totalGoals}** | ${periodCells.join(" | ")} | ${stats.shots} | ${fo} | ${blk} | ${hit} |`;
    };

    const awayRow = buildRow(game.awayTeam.abbrev, away);
    const homeRow = buildRow(game.homeTeam.abbrev, home);

    return `${header}\n${separator}\n${awayRow}\n${homeRow}`;
}