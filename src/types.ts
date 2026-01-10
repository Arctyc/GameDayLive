import { Context } from "@devvit/public-api";

export interface SportConfig {
  sport: string;
  enabled: boolean;
}

export interface SubredditConfig {
  sports: {
    nhl?: NHLConfig;
    // Future: nfl?: NFLConfig, nba?: NBAConfig, etc.
  };
}

export interface NHLConfig {
  teamAbbreviation: string;
  enablePostGameThreads: boolean;
}