import { reddit, type Post } from "@devvit/web/server";
import { Logger } from '../utils/Logger'; // TODO: Implement logging

// Create new thread
export async function createThread(
  context: any,
  title: string, 
  body: string
): Promise<string> {

  const post = await reddit.submitPost({
    subredditName: context.subredditName,
    title: title,
    text: body
  });

  await post.sticky();
  return post.id;
}

// Update existing thread
export async function updateThread(
  postId: Post["id"],
  body: string
): Promise<void> {
  
  const post = await reddit.getPostById(postId);

  await post.edit({
    text: body,
  });
}