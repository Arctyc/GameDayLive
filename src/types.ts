import { Subreddit } from "@devvit/web/server";

export interface LeagueConfig {
  league: string;
  enabled: boolean;
}

export interface SubredditConfig {
  league: "nhl"; // "nhl" | "mlb" | "nfl" | "nba";
    nhl?: NHLConfig;
    //nfl?: NFLConfig;
  enablePostgameThreads: boolean;
}

export interface NHLConfig {
  teamAbbreviation: string;
}