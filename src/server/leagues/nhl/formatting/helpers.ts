import type { NHLGame } from "../api";

export function formatTime(t: string): string {
    if (!t || !t.includes(":")) return "-";
    const [m, s] = t.split(":").map(Number);
    return `${m!.toString().padStart(2, "0")}:${s!.toString().padStart(2, "0")}`;
}

export function organizePlaysByPeriod(plays: any[]) {
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

export function getTeamById(game: NHLGame, teamId: number): string {
    if (game.homeTeam.id === teamId) return game.homeTeam.abbrev;
    if (game.awayTeam.id === teamId) return game.awayTeam.abbrev;
    return "UNK";
}

export function getPlayerInfo(game: NHLGame, playerId?: number) {
    if (!playerId) return null;
    const p = game.rosterSpots?.find((r: any) => r.playerId === playerId);
    if (!p) return { number: "00", name: "Unknown Player" };
    return {
        number: String(p.sweaterNumber ?? "00"),
        name: `${p.firstName.default} ${p.lastName.default}`
    };
}

export function getStrength(
    situationCode: string,
    scoringTeam: 'home' | 'away'
): string {
    if (!/^\d{4}$/.test(situationCode)) return "";
    if (situationCode === "0101" || situationCode === "1010") return ""; // Shootout

    const [awayGoalie, awaySkaters, homeSkaters, homeGoalie] =
        situationCode.split("").map(Number) as [number, number, number, number];

    const scoringIsHome = scoringTeam === 'home';
    const teamSkaters = scoringIsHome ? homeSkaters : awaySkaters;
    const oppSkaters  = scoringIsHome ? awaySkaters : homeSkaters;
    const teamGoalieInNet = scoringIsHome ? homeGoalie : awayGoalie;
    const oppGoalieInNet  = scoringIsHome ? awayGoalie : homeGoalie;

    if (oppGoalieInNet === 0) return "ENG";
    if (teamSkaters > oppSkaters && !teamGoalieInNet) return "EA";
    if (teamSkaters > oppSkaters) return "PP";
    if (teamSkaters < oppSkaters) return "SHG";
    return "";
}

export function getPeriodLabel(period: number, game: NHLGame, plays?: any[]): string {
    if (plays && plays.length > 0) {
        const descriptor = plays[0].periodDescriptor;
        const type = descriptor?.periodType;
        if (type === "SO") return "SO";
        if (type === "OT") return period === 4 ? "OT" : `${period - 3}OT`;
    } else {
        if (game.shootoutInUse && period === 5) return "SO";
        if (game.otInUse && period >= 4) return period === 4 ? "OT" : `${period - 3}OT`;
    }
    return String(period);
}

export function isShootoutPeriod(period: number, game: NHLGame, plays?: any[]): boolean {
    if (plays && plays.length > 0) {
        const descriptor = plays[0].periodDescriptor;
        return descriptor?.periodType === "SO";
    }
    return (game.shootoutInUse ?? false) && period === 5;
}

// Manually override annoyingly long strings, or calls that should have spaces instead of hyphens
export function formatInfraction(descKey: string | undefined): string {
    const s = descKey ?? "Penalty";

    switch (s) {
        case "too-many-men-on-the-ice":               return "Too&nbsp;Many&nbsp;Men";
        case "delaying-game-puck-over-glass":          return "DoG Puck Over Glass";
        case "delaying-game-unsuccessful-challenge":   return "DoG Unsuccessful Challenge";
        case "abuse-of-officials":                     return "Abuse&nbsp;of&nbsp;Officials";
        case "unsportsmanlike-conduct":                return "Unsportsmanlike Conduct";
        case "holding-the-stick":                      return "Holding&nbsp;the&nbsp;Stick";
        case "roughing-removing-opponents-helmet":     return "Roughing (Remove opp. helmet)";
        case "high-sticking-double-minor":             return "High-sticking";
        case "interference-goalkeeper":                return "Goalkeeper&nbsp;Interference";
        case "goalie-leave-crease":                    return "Leaving&nbsp;the&nbsp;Crease";
        case "illegal-check-to-head":                  return "Illegal&nbsp;Check&nbsp;to&nbsp;Head";
        default:
            return s.charAt(0).toUpperCase() + s.slice(1);
    }
}