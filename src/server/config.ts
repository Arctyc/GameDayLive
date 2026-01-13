import { redis } from '@devvit/web/server';
import { SubredditConfig, NHLConfig, LEAGUES } from './types';

const keyFor = (subreddit: string) => `subreddit:${subreddit}`;

/** Save a SubredditConfig to Redis */
export async function setSubredditConfig(subreddit: string, config: SubredditConfig) {
  const key = keyFor(subreddit);

  // Universal config data
  const fields: Record<string, string> = {
    league: config.league,
    enablePostgameThreads: config.enablePostgameThreads.toString(),
  };

  // Conditionally add league-specific data
  if (config.league === 'nhl' && config.nhl) {
    fields.nhl = JSON.stringify(config.nhl);
  }

  // Future leagues can add their own fields here
  // if (config.league === 'mlb' && config.mlb) { fields.mlb = JSON.stringify(config.mlb); }

  await redis.hSet(key, fields);
}

/** Get a SubredditConfig from Redis */
export async function getSubredditConfig(subreddit: string): Promise<SubredditConfig | undefined> {
  const key = `subreddit:${subreddit}`;
  const data = await redis.hGetAll(key);

  if (Object.keys(data).length === 0) return undefined;

  // Universal config data
  const config: SubredditConfig = {
    league: data.league as typeof LEAGUES[number],
    enablePostgameThreads: data.enablePostgameThreads === 'true',
  };

  // Conditionally add league-specific data
  if (data.league === 'nhl' && data.nhl) {
    config.nhl = JSON.parse(data.nhl) as NHLConfig;
  }

  return config;
};