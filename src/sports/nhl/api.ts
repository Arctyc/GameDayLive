import { Fetch } from "@devvit/public-api";

export interface NHLGame {
  id: number;
  season: number;
  gameType: number;
  gameDate: string;
  venue: {
    default: string;
  };
  startTimeUTC: string;
  easternUTCOffset: string;
  venueUTCOffset: string;
  gameState: string;
  gameScheduleState: string;
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
    };
    score?: number;
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
  };
  period?: number;
  periodDescriptor?: {
    number: number;
    periodType: string;
  };
  goals?: Array<{
    period: number;
    periodDescriptor: {
      number: number;
      periodType: string;
    };
    timeInPeriod: string;
    teamAbbrev: string;
    name: {
      default: string;
    };
    firstName: {
      default: string;
    };
    lastName: {
      default: string;
    };
    headshot: string;
    highlightClip?: number;
    goalsToDate: number;
    awayScore: number;
    homeScore: number;
    strength: string;
    shotType: string;
    assists?: Array<{
      playerId: number;
      name: {
        default: string;
      };
      assistsToDate: number;
    }>;
  }>;
  summary?: {
    penalties?: Array<{
      period: number;
      timeInPeriod: string;
      teamAbbrev: string;
      descKey: string;
      duration: number;
      type: string;
      committedByPlayer: string;
      drawnBy?: string;
    }>;
  };
}

export interface NHLScheduleResponse {
  gameWeek: Array<{
    date: string;
    games: NHLGame[];
  }>;
}

export async function getTodaysSchedule(fetch: Fetch): Promise<NHLGame[]> {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const response = await fetch(`https://api-web.nhle.com/v1/schedule/${today}`);
  
  if (!response.ok) {
    throw new Error(`NHL API error: ${response.status}`);
  }
  
  const data: NHLScheduleResponse = await response.json();
  
  // Find today's games
  const todayGames = data.gameWeek.find(day => day.date === today);
  return todayGames?.games || [];
}

export async function getGameData(gameId: number, fetch: Fetch, etag?: string): Promise<{
  game: NHLGame;
  etag: string;
  modified: boolean;
}> {
  const headers: HeadersInit = {};
  if (etag) {
    headers['If-None-Match'] = etag;
  }
  
  const response = await fetch(
    `https://api-web.nhle.com/v1/gamecenter/${gameId}/landing`,
    { headers }
  );
  
  if (response.status === 304) {
    // Not modified
    return { game: {} as NHLGame, etag: etag!, modified: false };
  }
  
  if (!response.ok) {
    throw new Error(`NHL API error: ${response.status}`);
  }
  
  const newEtag = response.headers.get('etag') || '';
  const data = await response.json();
  
  return {
    game: data,
    etag: newEtag,
    modified: true,
  };
}