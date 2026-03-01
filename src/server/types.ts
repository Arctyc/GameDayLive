import { NHLConfig } from "./leagues/nhl/types";

export const APPNAME = "gamedaylive" as const;
export const LEAGUES = ["nhl"] as const;

export interface ThreadConfig {
  enabled: boolean;
  sticky: boolean;
  lock: boolean;
  sort: 'new' | 'best';
}

export interface SubredditConfig {
  league: typeof LEAGUES[number];
  nhl?: NHLConfig;
  pregame: ThreadConfig;
  gameday: ThreadConfig;
  postgame: ThreadConfig;
}

// Enforce standard job data
interface BaseJobData {
  [key: string]: string | number;
  subredditName: string;
  gameId: string | number;
  jobTitle: string;
}

export interface NewJobData extends BaseJobData {}

export interface UpdateJobData extends BaseJobData {
  postId: string;
}

export interface CleanupJobData extends BaseJobData {
  postId: string;
}