import { context } from "@devvit/web/server";
import { getSubredditConfig } from "../../config";
import { NHL_TEAMS } from "./config";

export interface NHLGame {
  id: number;
  season: number;
  gameType: number;
  limitedScoring: boolean;
  gameDate: string;
  venue: {
    default: string;
  };
  venueLocation: {
    default: string;
  };
  startTimeUTC: string;
  easternUTCOffset: string;
  venueUTCOffset: string;
  tvBroadcasts?: Array<{
    network: string;
  }>;
  gameState: string;
  gameScheduleState: string;
  periodDescriptor?: {
    number: number;
    periodType: string;
    maxRegulationPeriods: number;
  };
  awayTeam: {
    id: number;
    abbrev: string;
    logo: string;
    darkLogo: string;
    placeName: {
      default: string;
    };
    commonName: {
      default: string;
      fr?: string;
    };
    score?: number;
    sog?: number;
  };
  homeTeam: {
    id: number;
    abbrev: string;
    logo: string;
    darkLogo: string;
    placeName: {
      default: string;
    };
    commonName: {
      default: string;
    };
    score?: number;
    sog?: number;
  };
  clock?: {
    timeRemaining: string;
    secondsRemaining: number;
    running: boolean;
    inIntermission: boolean;
  };
  plays?: Array<{
    eventId: number;
    periodDescriptor: {
      number: number;
      periodType: string;
      maxRegulationPeriods: number;
    };
    timeInPeriod: string;
    timeRemaining: string;
    situationCode: string;
    homeTeamDefendingSide: string;
    typeCode: number;
    typeDescKey: string;
    sortOrder: number;
    details?: {
      eventOwnerTeamId?: number;
      scoringPlayerId?: number;
      scoringPlayerTotal?: number;
      assist1PlayerId?: number;
      assist1PlayerTotal?: number;
      assist2PlayerId?: number;
      assist2PlayerTotal?: number;
      goalieInNetId?: number;
      awayScore?: number;
      homeScore?: number;
      shotType?: string;
      xCoord?: number;
      yCoord?: number;
      zoneCode?: string;
      highlightClip?: number;
      highlightClipFr?: number;
      highlightClipSharingUrl?: string;
      highlightClipSharingUrlFr?: string;
      // Penalty details
      typeCode?: string;
      descKey?: string;
      duration?: number;
      committedByPlayerId?: number;
      drawnByPlayerId?: number;
      servedByPlayerId?: number;
      // Faceoff details
      winningPlayerId?: number;
      losingPlayerId?: number;
      // Blocked-shot details
      blockingPlayerId?: number;
      shootingPlayerId?: number;
      // Hit details
      hittingPlayerId?: number;
      hitteePlayerId?: number;
    };
    pptReplayUrl?: string;
  }>;
  rosterSpots?: Array<{
    teamId: number;
    playerId: number;
    firstName: {
      default: string;
    };
    lastName: {
      default: string;
    };
    sweaterNumber: number;
    positionCode: string;
    headshot: string;
  }>;
  shootoutInUse?: boolean;
  otInUse?: boolean;
  maxPeriods?: number;
  gameOutcome?: {
    lastPeriodType: string;
  };
  summary?: any;
}

export interface NHLScheduleResponse {
  gameWeek: Array<{
    date: string;
    games: NHLGame[];
  }>;
}

// --------------- Pregame Data Types ---------------

export interface StandingsTeam {
  teamAbbrev: string;
  leagueSequence: number; // Rank
  gamesPlayed: number;
  wins: number;
  losses: number;
  otLosses: number;
  points: number;
  pointPctg: number;      // 0–1 decimal e.g. 0.75
  goalsFor: number;       // season total — divide by gamesPlayed for GF/GP
  goalsAgainst: number;   // season total — divide by gamesPlayed for GA/GP
  goalDifferential: number;
  l10Wins: number;
  l10Losses: number;
  l10OtLosses: number;
  streakCode: string;     // "W", "L", "OT"
  streakCount: number;
}

export interface GoalieStats {
  name: string;
  playerId: number;
  record: string;         // pre-formatted string e.g. "21-4-5"
  gaa?: number;
  savePctg?: number;      // 0–1 decimal
  shutouts?: number;
}

export interface SkaterLeader {
  name: string;
  playerId: number;
  teamId: number;
  goals: number;
  assists: number;
  points: number;
  plusMinus: number;
  avgTimeOnIce: string;   // pre-formatted string e.g. "22:14"
}

export interface SeriesGame {
  gameDate: string;
  awayAbbrev: string;
  homeAbbrev: string;
  awayScore?: number;
  homeScore?: number;
  gameOutcome?: string; // 'REG', 'OT', 'SO'
  gameState: string;
}

export interface PregameData {
  awayStandings?: StandingsTeam | undefined;
  homeStandings?: StandingsTeam | undefined;
  awayGoalies: GoalieStats[];
  homeGoalies: GoalieStats[];
  topSkaters: SkaterLeader[];
  seasonSeries: SeriesGame[];
}

// --------------- Pregame API Fetches ---------------

export async function getPregameData(game: NHLGame, fetch: any): Promise<PregameData> {
  const [standingsRes, landingRes, rightRailRes] = await Promise.allSettled([
    fetch(`https://api-web.nhle.com/v1/standings/now`),
    fetch(`https://api-web.nhle.com/v1/gamecenter/${game.id}/landing`),
    fetch(`https://api-web.nhle.com/v1/gamecenter/${game.id}/right-rail`),
  ]);

  // ---- Standings ----
  let awayStandings: StandingsTeam | undefined;
  let homeStandings: StandingsTeam | undefined;

  if (standingsRes.status === 'fulfilled' && standingsRes.value.ok) {
    const data = await standingsRes.value.json();
    const all: any[] = data.standings ?? [];

    const findTeam = (abbrev: string): StandingsTeam | undefined => {
      const s = all.find((t: any) => t.teamAbbrev?.default === abbrev);
      if (!s) return undefined;
      return {
        teamAbbrev: abbrev,
        leagueSequence: s.leagueSequence ?? 0,
        gamesPlayed: s.gamesPlayed ?? 0,
        wins: s.wins ?? 0,
        losses: s.losses ?? 0,
        otLosses: s.otLosses ?? 0,
        points: s.points ?? 0,
        pointPctg: s.pointPctg ?? 0,
        goalsFor: s.goalFor ?? 0,
        goalsAgainst: s.goalAgainst ?? 0,
        goalDifferential: s.goalDifferential ?? 0,
        l10Wins: s.l10Wins ?? 0,
        l10Losses: s.l10Losses ?? 0,
        l10OtLosses: s.l10OtLosses ?? 0,
        streakCode: s.streakCode ?? '',
        streakCount: s.streakCount ?? 0,
      };
    };

    awayStandings = findTeam(game.awayTeam.abbrev);
    homeStandings = findTeam(game.homeTeam.abbrev);
  }

  // ---- Landing (goalies, skater leaders, season series) ----
  let awayGoalies: GoalieStats[] = [];
  let homeGoalies: GoalieStats[] = [];
  let skaterLeaders: SkaterLeader[] = [];
  let seasonSeries: SeriesGame[] = [];

  if (landingRes.status === 'fulfilled' && landingRes.value.ok) {
    const landing: any = await landingRes.value.json();
    const matchup = landing.matchup ?? {};

    // ---- Goalies ----
    // goalieComparison.{awayTeam|homeTeam}.leaders[0] is the top goalie by games played
    const gc = matchup.goalieComparison ?? {};
    const parseGoalies = (side: 'away' | 'home'): GoalieStats[] => {
      const key = side === 'away' ? 'awayTeam' : 'homeTeam';
      const leaders: any[] = gc[key]?.leaders ?? [];
      return leaders
        .filter((l: any) => l.record)
        .slice(0, 2)
        .map((g: any): GoalieStats => ({
          name: g.name?.default ?? 'Unknown',
          playerId: g.playerId ?? 0,
          record: g.record ?? '-',
          gaa: g.gaa,
          savePctg: g.savePctg,
          shutouts: g.shutouts,
        }));
    };
    awayGoalies = parseGoalies('away');
    homeGoalies = parseGoalies('home');

    // ---- Skater leaders ----
    // skaterSeasonStats.skaters contains all roster skaters for both teams
    // sorted descending by points to get top 3 per team
    const allSkaters: any[] = matchup.skaterSeasonStats?.skaters ?? [];
    const LEADERS_PER_TEAM = 3;

    const getTopSkaters = (teamId: number): SkaterLeader[] =>
      allSkaters
        .filter((s: any) => s.teamId === teamId && s.points != null)
        .sort((a: any, b: any) => b.points - a.points)
        .slice(0, LEADERS_PER_TEAM)
        .map((s: any): SkaterLeader => ({
          name: s.name?.default ?? 'Unknown',
          playerId: s.playerId,
          teamId: s.teamId,
          goals: s.goals ?? 0,
          assists: s.assists ?? 0,
          points: s.points ?? 0,
          plusMinus: s.plusMinus ?? 0,
          avgTimeOnIce: s.avgTimeOnIce ?? '-',
        }));

    skaterLeaders = [
      ...getTopSkaters(game.awayTeam.id),
      ...getTopSkaters(game.homeTeam.id),
    ];

  }

  // ---- Season series ----
  if (rightRailRes.status === 'fulfilled' && rightRailRes.value.ok) {
    const rightRail: any = await rightRailRes.value.json();
    const rawSeries: any[] = rightRail.seasonSeries ?? [];
    seasonSeries = rawSeries
      .map((g: any): SeriesGame => ({
        gameDate: g.gameDate ?? '',
        awayAbbrev: g.awayTeam?.abbrev ?? '',
        homeAbbrev: g.homeTeam?.abbrev ?? '',
        awayScore: g.awayTeam?.score,
        homeScore: g.homeTeam?.score,
        gameOutcome: g.gameOutcome?.lastPeriodType,
        gameState: g.gameState ?? '',
      }));
  }

  return {
    awayStandings,
    homeStandings,
    awayGoalies,
    homeGoalies,
    topSkaters: skaterLeaders,
    seasonSeries,
  };
}

export async function getTodaysSchedule(fetch: any): Promise<NHLGame[]> {

  // Load subreddit config to know which team we're using
	const config = await getSubredditConfig(context.subredditName);
	if (!config?.nhl) return [];

	const teamAbbrev = config.nhl.teamAbbreviation;

	// Find the team timezone from NHL_TEAMS
	const team = NHL_TEAMS.find(t => t.value === teamAbbrev);
	if (!team) return [];

	const tz = team.timezone;

	// Get today's date IN THAT TIMEZONE
	const today = new Intl.DateTimeFormat('en-CA', {
		timeZone: tz,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(new Date()); 
	// en-CA → YYYY-MM-DD

  try {
    const response = await fetch(`https://api-web.nhle.com/v1/schedule/${today}`);
    
    if (!response.ok) {
      throw new Error(`NHL API error: ${response.status}`);
    }

    const data: NHLScheduleResponse = await response.json();
    const todayGames = data.gameWeek.find(day => day.date === today);
    return todayGames?.games || [];
    
  } catch (error) {
    console.error(`Failed to fetch NHL schedule for ${today}:`, error);
    return [];
  }
}

export async function getGameData(gameId: number, fetch: any, etag?: string): Promise<{
  game: NHLGame;
  etag: string;
  modified: boolean;
}> {
  const headers: Record<string, string> = {};
  if (etag) {
    headers['If-None-Match'] = etag;
  }
  
  const response = await fetch(
    `https://api-web.nhle.com/v1/gamecenter/${gameId}/play-by-play`,
    { headers }
  );
  
  if (response.status === 304) {
    // No changes to game data
    return { game: null as any, etag: etag!, modified: false };
  }
  
  if (!response.ok) {
    throw new Error(`NHL API error: ${response.status}`);
  }
  
  const data = await response.json();
  const newEtag = response.headers.get('etag') || '';
  
  return {
    game: data,
    etag: newEtag,
    modified: true,
  };
}