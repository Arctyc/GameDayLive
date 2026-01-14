import { redis } from '@devvit/web/server';
import { SubredditConfig } from './types';
import { Logger } from './utils/Logger';

const keyFor = (subreddit: string) => `subreddit:${subreddit}`;

/** Save a SubredditConfig to Redis */
export async function setSubredditConfig(subredditName: string, config: SubredditConfig): Promise<void> {
  const logger = await Logger.Create('Config - Set');
  
  const key = keyFor(subredditName);
  await redis.set(key, JSON.stringify(config));
  logger.info(`Saved config for ${subredditName}:`, config);
}

/** Get a SubredditConfig from Redis */
export async function getSubredditConfig(subredditName: string): Promise<SubredditConfig | undefined> {
  const logger = await Logger.Create('Config - Get');
  
  const key = keyFor(subredditName);
  const data = await redis.get(key);

  if (!data) {
    logger.info(`No config found for ${subredditName}`);
    return undefined;
  }
  
  const config = JSON.parse(data) as SubredditConfig;
  logger.info(`Retrieved config for ${subredditName}:`, config);
  return config;
}