
import { SubredditConfig } from './types';
import { context } from '@devvit/server';
import { redis } from '@devvit/redis';

export async function handleConfigSubmit(
  subredditConfig: SubredditConfig,
){
  const subredditName = context.subredditName;
  if (!subredditName) {
    throw new Error("No subreddit context available.");
  }
  await setSubredditConfig( subredditName, subredditConfig );
}

export async function setSubredditConfig(
  subredditName: string,
  config: SubredditConfig,
): Promise<void> {
  console.log(`Setting subredditConfig for subredditName: ${subredditName} with data: ${JSON.stringify(config)}`);
  await redis.set(subredditName, JSON.stringify(config));
}

export async function getSubredditConfig(subredditName: string){
  const data = await redis.get(subredditName)
  if (!data){
    throw new Error("No subreddit data available.");
  }
  return JSON.parse(data);
}