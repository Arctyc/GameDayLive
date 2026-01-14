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
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
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
    `https://api-web.nhle.com/v1/gamecenter/${gameId}/landing`,
    { headers }
  );
  
  if (response.status === 304) {
    // No changes to game data
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