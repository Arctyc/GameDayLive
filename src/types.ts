import { Context } from "@devvit/public-api";

export interface SportConfig {
  sport: string;
  enabled: boolean;
}

export interface SubredditConfig {
  league: "nhl"; // "nhl" | "nfl" | "nba";
    nhl?: NHLConfig;
  //nfl?: NFLConfig;
}

export interface NHLConfig {
  teamAbbreviation: string;
  enableGameDayThreads: boolean;
  enablePostGameThreads: boolean;
}