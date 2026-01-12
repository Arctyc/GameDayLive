
import { Subreddit } from "@devvit/web/server";
import { SubredditConfig } from "../types.js";
import { redis } from '@devvit/redis';

const CONFIG_KEY_PREFIX = "subreddit:";

export async function handleConfigSubmit(
  context: any,
  formData: SubredditConfig
){
  const subredditName = context.subredditName;

  if (!subredditName) {
    throw new Error("No subreddit context available.");
  }
  await setSubredditConfig( subredditName, formData );
}

export async function setSubredditConfig(
  subredditName: string,
  config: SubredditConfig,
): Promise<void> {
  const key = `${CONFIG_KEY_PREFIX}${subredditName}:config`;
  await redis.set(key, JSON.stringify(config));
}

export async function getSubredditConfig(subredditName: string){
  const data = await redis.get(subredditName)
  if (!data){
    throw new Error("No subreddit data available.");
  }
  return JSON.parse(data);
}