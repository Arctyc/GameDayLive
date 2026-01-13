
export const LEAGUES = ["nhl", "mlb", "nfl", "nba"] as const;

export interface SubredditConfig {
  league: typeof LEAGUES[number]; 
  nhl?: NHLConfig;
  enablePostgameThreads: boolean;
}

export interface NHLConfig {
  teamAbbreviation: string;
}