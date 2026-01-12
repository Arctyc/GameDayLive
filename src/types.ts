export interface LeagueConfig {
  league: string;
  enabled: boolean;
}

export interface SubredditConfig {
  league: "nhl"; // "nhl" | "nfl" | "nba";
    nhl?: NHLConfig;
  //nfl?: NFLConfig;
}

export interface NHLConfig {
  teamAbbreviation: string;
  enablePostGameThreads: boolean;
}