
export const LEAGUES = ["nhl"] as const; // Add future leagues here (1)

export interface SubredditConfig {
  league: typeof LEAGUES[number]; 
  nhl?: NHLConfig;
  // here (2)
  enablePostgameThreads: boolean;
}

export interface NHLConfig {
  teamAbbreviation: string;
}

// and here (3) as necessary