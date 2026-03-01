import type { NHLGame } from "../api";
import { organizePlaysByPeriod, isShootoutPeriod, getPeriodLabel } from "./helpers";

interface TeamLinescoreStats {
    periodGoals: Record<number, number>;
    totalGoals: number;
    shots: number;
    faceoffPct: string;
    blocks: number;
    hits: number;
}

/**
 * Pulls a stat value from game.summary.teamGameStats (provided by the NHL play-by-play endpoint).
 * Falls back to "-" if the data isn't present yet (e.g. pre-game).
 *
 * teamGameStats shape:
 * [{ category: "faceoffWinningPctg", awayValue: 0.523, homeValue: 0.477 }, ...]
 */
function getTeamStat(
    teamGameStats: Array<{ category: string; awayValue: number; homeValue: number }>,
    category: string,
    side: 'away' | 'home'
): number | null {
    const entry = teamGameStats.find(s => s.category === category);
    if (!entry) return null;
    return side === 'away' ? entry.awayValue : entry.homeValue;
}

function buildLinescoreStats(game: NHLGame): { away: TeamLinescoreStats; home: TeamLinescoreStats } {
    const plays = game.plays ?? [];
    const { goals } = organizePlaysByPeriod(plays);
    const currentPeriod = game.periodDescriptor?.number ?? 0;

    const teamGameStats: Array<{ category: string; awayValue: number; homeValue: number }> =
        (game.summary as any)?.teamGameStats ?? [];

    const buildStats = (side: 'away' | 'home'): TeamLinescoreStats => {
        const teamId = side === 'home' ? game.homeTeam.id : game.awayTeam.id;

        // Count goals per period for this team
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

        // These come from summary.teamGameStats when available
        const foRaw = getTeamStat(teamGameStats, 'faceoffWinningPctg', side);
        const faceoffPct = foRaw !== null ? `${(foRaw * 100).toFixed(1)}%` : "-";

        const blocksRaw = getTeamStat(teamGameStats, 'blockedShots', side);
        const blocks = blocksRaw ?? 0;

        const hitsRaw = getTeamStat(teamGameStats, 'hits', side);
        const hits = hitsRaw ?? 0;

        return { periodGoals, totalGoals, shots, faceoffPct, blocks, hits };
    };

    return { away: buildStats('away'), home: buildStats('home') };
}

export function buildBodyLinescore(game: NHLGame): string {
    const currentPeriod = game.periodDescriptor?.number ?? 0;
    if (currentPeriod === 0) return "";

    const { away, home } = buildLinescoreStats(game);
    const plays = game.plays ?? [];
    const { goals } = organizePlaysByPeriod(plays);

    // Determine which period columns to show
    // Always show 1–3, add OT/SO columns dynamically
    const periodColumns: Array<{ label: string; period: number }> = [
        { label: "1st", period: 1 },
        { label: "2nd", period: 2 },
        { label: "3rd", period: 3 },
    ];

    for (let p = 4; p <= currentPeriod; p++) {
        const playsInPeriod = goals[p] ?? [];
        // isShootoutPeriod needs some plays to inspect; fall back to game flags
        const label = getPeriodLabel(p, game, playsInPeriod.length > 0 ? playsInPeriod : undefined);
        periodColumns.push({ label, period: p });
    }

    const teamGameStats: any[] = (game.summary as any)?.teamGameStats ?? [];
    const hasExtendedStats = teamGameStats.length > 0;

    // Build header row
    const periodHeaders = periodColumns.map(c => c.label).join(" | ");
    const extendedHeaders = hasExtendedStats ? " | F/O% | BLK | HIT" : "";
    const header = `| Team | ${periodHeaders} | Total | SOG${extendedHeaders} |`;
    const separator = `|${["", ...periodColumns.map(() => ""), "", "", ...(hasExtendedStats ? ["", "", ""] : [])].map(() => "---").join("|")}|`;

    // Build a row for one team
    const buildRow = (
        abbrev: string,
        stats: TeamLinescoreStats,
    ): string => {
        const periodCells = periodColumns.map(c => {
            // Don't show shootout goals in linescore (they don't count toward score display)
            const periodPlays = goals[c.period] ?? [];
            if (isShootoutPeriod(c.period, game, periodPlays.length > 0 ? periodPlays : undefined)) {
                return "-";
            }
            return String(stats.periodGoals[c.period] ?? 0);
        });

        const extendedCells = hasExtendedStats
            ? ` | ${stats.faceoffPct} | ${stats.blocks || "-"} | ${stats.hits || "-"}`
            : "";

        return `| **${abbrev}** | ${periodCells.join(" | ")} | **${stats.totalGoals}** | ${stats.shots}${extendedCells} |`;
    };

    const awayRow = buildRow(game.awayTeam.abbrev, away);
    const homeRow = buildRow(game.homeTeam.abbrev, home);

    return `**LINESCORE** swipe→\n\n${header}\n${separator}\n${awayRow}\n${homeRow}\n\n`;
}