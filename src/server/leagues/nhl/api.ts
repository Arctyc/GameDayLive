import { context } from "@devvit/web/server";
import { getSubredditConfig } from "../../config";
import { NHL_TEAMS, NHLTeam } from "./config";

export interface NHLGame {
  id: number;
  season: number;
  gameType: number;
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
    };
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

  const response = await fetch(`https://api-web.nhle.com/v1/schedule/${today}`);
  
  if (!response.ok) {
    throw new Error(`NHL API error: ${response.status}`);
  }
  
  const data: NHLScheduleResponse = await response.json();
  
  const todayGames = data.gameWeek.find(day => day.date === today);
  return todayGames?.games || [];
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