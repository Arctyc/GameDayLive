import { redis } from '@devvit/web/server';
import { SubredditConfig } from './types';

const keyFor = (subreddit: string) => `subreddit:${subreddit}`;

/** Save a SubredditConfig to Redis */
export async function setSubredditConfig(subreddit: string, config: SubredditConfig): Promise<void> {
  const key = keyFor(subreddit);
  await redis.set(key, JSON.stringify(config));
  console.log(`Saved config for r/${subreddit}:`, config);
}

/** Get a SubredditConfig from Redis */
export async function getSubredditConfig(subreddit: string): Promise<SubredditConfig | undefined> {
  const key = keyFor(subreddit);
  const data = await redis.get(key);

  if (!data) {
    console.log(`No config found for r/${subreddit}`);
    return undefined;
  }
  
  const config = JSON.parse(data) as SubredditConfig;
  console.log(`Retrieved config for r/${subreddit}:`, config);
  return config;
}