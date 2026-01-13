import { redis } from '@devvit/web/server';
import { SubredditConfig } from './types';
import { Logger } from './utils/Logger';

const keyFor = (subreddit: string) => `subreddit:${subreddit}`;

/** Save a SubredditConfig to Redis */
export async function setSubredditConfig(subreddit: string, config: SubredditConfig): Promise<void> {
  const logger = await Logger.Create('Config - Set');
  
  const key = keyFor(subreddit);
  await redis.set(key, JSON.stringify(config));
  logger.info(`Saved config for r/${subreddit}:`, config);
}

/** Get a SubredditConfig from Redis */
export async function getSubredditConfig(subreddit: string): Promise<SubredditConfig | undefined> {
  const logger = await Logger.Create('Config - Get');
  
  const key = keyFor(subreddit);
  const data = await redis.get(key);

  if (!data) {
    logger.info(`No config found for r/${subreddit}`);
    return undefined;
  }
  
  const config = JSON.parse(data) as SubredditConfig;
  logger.info(`Retrieved config for r/${subreddit}:`, config);
  return config;
}