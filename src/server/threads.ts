import { Post, reddit } from "@devvit/web/server";
import { redis } from '@devvit/redis';
import { scheduler } from '@devvit/web/server';
import { Logger } from './utils/Logger';
import { createLogger } from "vite";

//TODO: Implement optional sticky status of both GDT and PGT

// Create new thread
export async function createThread(
	context: any,
	title: string,
	body: string
): Promise<{ success: boolean; post?: Post; error?: string }> {
	const logger = await Logger.Create('Thread - Create');

	try {
    // Submit post create request
		const post = await reddit.submitPost({
			subredditName: context.subredditName,
			title: title,
			text: body,	
		});

		logger.info(`Post created in ${context.subredditName} with title: "${title}"`);

		// HACK: Temporary comment - remove for v1.0
		await addComment(
			post,
`This thread was created by GameDayLive, an application that is in development. There may be bugs.  

For more information, including bug reports or to find out how to use this application on your subreddit, even for other sports, visit [the github page](https://github.com/Arctyc/GameDayLive).`
		);
		// -------- END TEMPORT COMMENT --------

		// Attempt to sort by new
		try {
			await post.setSuggestedCommentSort("NEW");
			logger.info(`Post sort by new succeeded for ${post.id}`)
		} catch (sortNewErr) {
			logger.warn(`Failed to sticky post in ${post.id}:`, sortNewErr);
		}

		// Attempt to sticky //TODO: only GDT?
		try {
			await post.sticky();
			logger.info(`Post sticky succeeded for ${post.id}`);
		} catch (stickyErr) {
			logger.warn(`Failed to sticky post in ${post.id}:`, stickyErr);
		}

		return { success: true, post };

	} catch (err) {
		logger.error(`Failed to create post in ${context.subredditName}:`, err);
		return { success: false, error: err instanceof Error ? err.message : String(err) };
	}
}

// Update existing thread
export async function updateThread(
	postId: Post["id"],
	body: string
): Promise<{ success: boolean; postId?: string; error?: string }> {
  const logger = await Logger.Create('Thread - Update');

	// Find thread
	try {
		const post = await reddit.getPostById(postId);
    if (!post) {
      logger.error(`Cannot find post ${postId}`);
      return { 
        success: false, 
        error: `Post ${postId} not found`,
      };
    }

    // Submit edit request
	try {
		await post.edit({ text: body });
		logger.info(`Post ${postId} successfully updated.`);
	} catch (editErr) {
		logger.error(`Failed to edit post ${postId}:`, editErr);
		return {
			success: false,
			error: editErr instanceof Error ? editErr.message : String(editErr),
		};
	}
    
	return { success: true, postId };

	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

export async function cleanupThread(
    postId: Post["id"]
): Promise<{ success: boolean; postId?: string; error?: string }> {
    const logger = await Logger.Create('Thread - Cleanup');

    try {
        const post = await reddit.getPostById(postId);
        
        if (!post) {
            logger.error(`Cannot find post ${postId}`);
            return { 
                success: false, 
                error: `Post ${postId} not found`,
            };
        }

        // Cleanup actions
		// TODO: Use functions for trySticky tryUnsticky tryLock
        await post.unsticky();
		
		// Lock post
        //await post.lock(); TODO: Is this wanted? (add to config options?)

		// TODO: del res lock on original post
        
        logger.info(`Post ${postId} cleaned up.`);
        return { success: true, postId };

    } catch (err) {
        logger.error(`Failed to cleanup post ${postId}:`, err);
        return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

// TODO:

export async function addComment(post: Post, comment: string){
	const logger = await Logger.Create('Thread - Add comment');

	try {
		await post.addComment({
			text: comment
		});

		logger.info(`Post comment added to post ${post.id}`);
	} catch (stickyErr) {
		logger.warn(`Failed to add comment to post ${post.id}:`, stickyErr);
	}
}

// TODO:
export async function tryStickyThread(){

}

// TODO:
export async function tryUnstickyThread(){

}

// TODO:
export async function tryLockThread(){

}

// TODO:

export async function tryCancelThreadJob(jobTitle: string){ // TODO: Add post menu to devvit.json to cancel live updates from thread
	const logger = await Logger.Create('Thread - Cancel Job');
	// TODO: Look up job by jobId
	try{

		// Retrieve the job ID from Redis (should be stored when the job was created)
		const jobId = await redis.get(`job:${jobTitle}`);
		
		if (!jobId){
			throw new Error(`Job ${jobTitle} not found}`);
		}

		// Cancel the scheduled job
		await scheduler.cancelJob(jobId);

		// Clean up the stored job ID
		await redis.del(`job:${jobTitle}`);

	} catch (err) {
		logger.error(`Failed to cancel job`, err);
	}
}