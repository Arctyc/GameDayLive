import { getSubredditConfig } from "../../../config";
import { getTeamTimezone } from "../config";
import type { NHLGame, PregameData, StandingsTeam, GoalieStats } from "../api";
import { context } from "@devvit/web/server";

// --------------- Title ---------------

export async function formatPregameTitle(game: NHLGame): Promise<string> {
    const config = await getSubredditConfig(context.subredditName);
    const teamAbbrev = config!.nhl!.teamAbbreviation;
    const timezone = getTeamTimezone(teamAbbrev)!;

    const startTime = new Date(game.startTimeUTC);
    const localTime = startTime.toLocaleTimeString('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
    });

    // Use gameDate (local date) not startTimeUTC date — a 7:30pm PT game
    // has a next-day UTC date, so startTimeUTC.toDateString() would be wrong
    return `Pre-Game Thread | ${game.awayTeam.abbrev} @ ${game.homeTeam.abbrev} | ${game.gameDate} ${localTime}`;
}

// --------------- Body ---------------

export async function formatPregameBody(game: NHLGame, data: PregameData): Promise<string> {
    const config = await getSubredditConfig(context.subredditName);
    const teamAbbrev = config!.nhl!.teamAbbreviation;
    const timezone = getTeamTimezone(teamAbbrev)!;

    const sections: string[] = [];

    sections.push(buildHeader(game, timezone));
    sections.push("---");
    sections.push(buildStandings(game, data));
    sections.push("---");
    sections.push(buildTeamStats(game, data));
    sections.push("---");
    sections.push(buildGoalies(game, data));
    sections.push("---");
    sections.push(buildSkaterLeaders(game, data));
    sections.push("---");
    sections.push(buildSeasonSeries(game, data));

    return sections.join("\n\n");
}

// --------------- Header ---------------

function buildHeader(game: NHLGame, timezone: string): string {
    const startTime = new Date(game.startTimeUTC);
    const localTime = startTime.toLocaleTimeString('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
    });

    const networks = game.tvBroadcasts && game.tvBroadcasts.length > 0
        ? game.tvBroadcasts.map(b => b.network).join(", ")
        : "N/A";

    const gameCenterUrl = `https://www.nhl.com/gamecenter/${game.id}`;
    const awayName = `${game.awayTeam.placeName.default} ${game.awayTeam.commonName.default}`;
    const homeName = `${game.homeTeam.placeName.default} ${game.homeTeam.commonName.default}`;

    return `# [${awayName} @ ${homeName}](${gameCenterUrl})
**Start Time:** ${localTime} | **Venue:** ${game.venue.default} | **Networks:** ${networks}`;
}

// --------------- Standings ---------------

function buildStandings(game: NHLGame, data: PregameData): string {
    const away = data.awayStandings;
    const home = data.homeStandings;

    if (!away || !home) return `## Standings\n*Standings data unavailable.*`;

    const formatRow = (abbrev: string, s: StandingsTeam): string => {
        const pct = s.pointPctg.toFixed(3).replace(/^0/, ''); // 0.750 → .750
        const l10 = `${s.l10Wins}-${s.l10Losses}-${s.l10OtLosses}`;
        const strk = `${s.streakCode}${s.streakCount}`;
        return `| **${abbrev}** | ${s.gamesPlayed} | ${s.wins} | ${s.losses} | ${s.otLosses} | ${s.points} | ${pct} | ${l10} | ${strk} |`;
    };

    return `## Standings
| Team | GP | W | L | OT | PTS | PTS% | L10 | STRK |
|---|---|---|---|---|---|---|---|---|
${formatRow(game.awayTeam.abbrev, away)}
${formatRow(game.homeTeam.abbrev, home)}`;
}

// --------------- Team Stats ---------------
// PP%/PK%/SF/SA are not available from any endpoint without additional calls.
// GF/GP and GA/GP are derived from standings season totals.

function buildTeamStats(game: NHLGame, data: PregameData): string {
    const away = data.awayStandings;
    const home = data.homeStandings;

    if (!away || !home) return `## Team Stats\n*Stats unavailable.*`;

    const formatRow = (abbrev: string, s: StandingsTeam): string => {
        const gfGp = (s.goalsFor / s.gamesPlayed).toFixed(2);
        const gaGp = (s.goalsAgainst / s.gamesPlayed).toFixed(2);
        return `| **${abbrev}** | ${gfGp} | ${gaGp} |`;
    };

    return `## Team Stats
| Team | GF/GP | GA/GP |
|---|---|---|
${formatRow(game.awayTeam.abbrev, away)}
${formatRow(game.homeTeam.abbrev, home)}`;
}

// --------------- Projected Goalies ---------------

function buildGoalies(game: NHLGame, data: PregameData): string {
    const away = data.awayGoalie;
    const home = data.homeGoalie;

    if (!away && !home) return `## Projected Goalies\n*Goalie data unavailable.*`;

    const formatSv = (v?: number): string =>
        v != null ? `.${Math.round(v * 1000).toString().padStart(3, '0')}` : '-';

    const formatRow = (abbrev: string, g: GoalieStats | undefined): string => {
        if (!g) return `| **${abbrev}** | - | - | - | - |`;
        const gaa = g.gaa != null ? g.gaa.toFixed(2) : '-';
        return `| **${abbrev}** | ${g.name} | ${g.record} | ${gaa} | ${formatSv(g.savePctg)} |`;
    };

    return `## Projected Goalies
| Team | Goalie | Record | GAA | SV% |
|---|---|---|---|---|
${formatRow(game.awayTeam.abbrev, away)}
${formatRow(game.homeTeam.abbrev, home)}`;
}

// --------------- Skater Leaders ---------------

function buildSkaterLeaders(game: NHLGame, data: PregameData): string {
    const leaders = data.skaterLeaders;

    if (!leaders || leaders.length === 0) return `## Skater Leaders\n*Skater data unavailable.*`;

    const rows = leaders.map(p => {
        const abbrev = p.teamId === game.awayTeam.id ? game.awayTeam.abbrev : game.homeTeam.abbrev;
        return `| **${abbrev}** | ${p.name} | ${p.goals} | ${p.assists} | ${p.points} |`;
    });

    return `## Skater Leaders
| Team | Player | G | A | PTS |
|---|---|---|---|---|
${rows.join('\n')}`;
}

// --------------- Season Series ---------------

function buildSeasonSeries(game: NHLGame, data: PregameData): string {
    const series = data.seasonSeries;

    if (!series || series.length === 0) {
        return `## Season Series\n*Missing data...*`;
    }

    const awayAbbrev = game.awayTeam.abbrev;
    const homeAbbrev = game.homeTeam.abbrev;

    // Tally record from completed games only
    let awayWins = 0, homeWins = 0, otDecisions = 0;
    for (const g of series) {
        if (g.awayScore == null || g.homeScore == null) continue;
        if (g.gameState !== 'FINAL' && g.gameState !== 'OFF') continue;
        const inOt = g.gameOutcome === 'OT' || g.gameOutcome === 'SO';
        if (inOt) otDecisions++;
        const awayIsAway = g.awayAbbrev === awayAbbrev;
        const awayWon = g.awayScore > g.homeScore;
        if (awayIsAway ? awayWon : !awayWon) awayWins++;
        else homeWins++;
    }

    const seriesHeader = buildSeriesHeader(awayAbbrev, homeAbbrev, awayWins, homeWins, otDecisions);

    const rows = series.map(g => {
        const date = formatSeriesDate(g.gameDate);
        const isPlayed = g.awayScore != null && (g.gameState === 'FINAL' || g.gameState === 'OFF');
        const score = isPlayed
            ? `${g.awayScore}-${g.homeScore} **${g.awayScore! > g.homeScore! ? g.awayAbbrev : g.homeAbbrev}**`
            : `*TBD*`;
        return `| ${date} | ${g.awayAbbrev} | ${g.homeAbbrev} | ${score} |`;
    });

    return `## Season Series ${seriesHeader}
| Date | Away | Home | Score |
|---|---|---|---|
${rows.join('\n')}`;
}

function buildSeriesHeader(away: string, home: string, awayWins: number, homeWins: number, otDecisions: number): string {
    if (awayWins === 0 && homeWins === 0) return `*(First meeting)*`;
    if (awayWins > homeWins) return `*(${away} leads ${awayWins}-${homeWins}-${otDecisions})*`;
    if (homeWins > awayWins) return `*(${home} leads ${homeWins}-${awayWins}-${otDecisions})*`;
    return `*(Series tied ${awayWins}-${homeWins}-${otDecisions})*`;
}

function formatSeriesDate(dateStr: string): string {
    if (!dateStr) return '-';
    const d = new Date(dateStr + 'T12:00:00Z');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}