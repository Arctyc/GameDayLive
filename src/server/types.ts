import { NHLConfig } from "./leagues/nhl/types";

export const LEAGUES = ["nhl"] as const;

export interface SubredditConfig {
  league: typeof LEAGUES[number]; 
  nhl?: NHLConfig;
  // Additional leagues here
  enablePostgameThreads: boolean;
  enableThreadLocking: boolean;
}

// Enforce standard job data
interface BaseJobData {
  [key: string]: string | number;
  subredditName: string;
  gameId: string | number;
  jobTitle: string; // Make this human readable and unique when scheduling jobs. i.e. const jobTitle = `${formatThreadTitle(game)} - ${game.id}`;
}

export interface NewJobData extends BaseJobData {}

export interface UpdateJobData extends BaseJobData {
  postId: string;
}

export interface CleanupJobData extends BaseJobData {
  postId: string;
}