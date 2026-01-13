
export const LEAGUES = ["nhl"] as const; // Add future leagues here

export interface SubredditConfig {
  league: typeof LEAGUES[number]; 
  nhl?: NHLConfig;
  enablePostgameThreads: boolean;
}

export interface NHLConfig {
  teamAbbreviation: string;
}