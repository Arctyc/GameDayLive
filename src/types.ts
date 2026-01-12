import { Subreddit } from "@devvit/web/server";

export const LEAGUES = ["nhl", "mlb", "nfl", "nba"] as const;

export interface LeagueConfig {
  league: string;
  enabled: boolean;
}

export interface SubredditConfig {
  league: typeof LEAGUES[number]; 
  nhl?: NHLConfig;
  enablePostgameThreads: boolean;
}

export interface NHLConfig {
  teamAbbreviation: string;
}