import { redis } from '@devvit/web/server';
import { SubredditConfig } from './types';
import { Logger } from './utils/Logger';

const keyFor = (subreddit: string) => `subreddit:${subreddit}`;

function isLegacyConfig(config: any): boolean {
  return 'enableThreadSticky' in config;
}

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
    logger.warn(`No config found for ${subredditName}`);
    return undefined;
  }

  const config = JSON.parse(data) as SubredditConfig;
  logger.debug(`Retrieved config for ${subredditName}:`, config);
  return config;
}

/** Checks stored config format and handles migration if legacy shape is detected.
 *  Call from an onUpdate trigger to catch stale configs on app update. */
export async function validateConfigFormat(subredditName: string): Promise<void> {
  const logger = await Logger.Create('Config - Validate');

  const key = keyFor(subredditName);
  const data = await redis.get(key);

  if (!data) {
    logger.debug(`No config found for ${subredditName}, skipping validation`);
    return;
  }

  const parsed = JSON.parse(data);

  if (isLegacyConfig(parsed)) {
    logger.warn(`Legacy config detected for ${subredditName}`);
    // TODO: sendModmail to notify subreddit to re-save their config
    return;
  }

  logger.debug(`Config format is current for ${subredditName}`);
}