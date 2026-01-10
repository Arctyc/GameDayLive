import { Context, JobContext } from "@devvit/public-api";
import { SubredditConfig } from "../types.js";

const CONFIG_KEY_PREFIX = "subreddit:";

export async function getSubredditConfig(
  subredditId: string,
  context: Context | JobContext
): Promise<SubredditConfig | null> {
  const key = `${CONFIG_KEY_PREFIX}${subredditId}:config`;
  const data = await context.redis.get(key);
  
  if (!data) {
    return null;
  }
  
  return JSON.parse(data);
}

export async function setSubredditConfig(
  subredditId: string,
  config: SubredditConfig,
  context: Context | JobContext
): Promise<void> {
  const key = `${CONFIG_KEY_PREFIX}${subredditId}:config`;
  await context.redis.set(key, JSON.stringify(config));
}