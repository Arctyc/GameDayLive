import { Post, reddit } from "@devvit/web/server";
import { redis } from '@devvit/redis';
import { scheduler } from '@devvit/web/server';
import { Logger } from './utils/Logger';

//TODO: Implement optional sticky status of both GDT and PGT

// Create new thread
export async function tryCreateThread(
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
		await tryAddComment(
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
export async function tryUpdateThread(
	postId: Post["id"],
	body: string
): Promise<{ success: boolean; postId?: string; error?: string }> {
  const logger = await Logger.Create('Thread - Update');

	// TODO: if thread exists
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

export async function tryCleanupThread(
    postId: Post["id"]
): Promise<{ success: boolean; postId?: string; error?: string }> {
    const logger = await Logger.Create('Thread - Cleanup');

	// Guard against undefined/null postId
    if (!postId) {
        logger.warn('No post ID provided, skipping cleanup');
        return { 
            success: false, 
            error: 'No post ID provided',
        };
    }

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
        await post.unsticky();
		
		// Lock post
        //await post.lock(); NOTE: Is this wanted? (add to config options?)

		// TODO: delete redis jobs associated with post		
		// NOTE: Find any redis with jobTitle that includes gameId in string
        
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

export async function tryAddComment(post: Post, comment: string){
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

// TODO: add function
export async function tryStickyThread(){

}

// TODO: add function
export async function tryUnstickyThread(){

}

// TODO: add function
export async function tryLockThread(){

}

// TODO: add function
export async function tryCancelScheduledJob(jobTitle: string){ // TODO: Add post menu to devvit.json to cancel live updates from thread
	const logger = await Logger.Create('Thread - Cancel Job');

	try{
		const jobId = await redis.get(`job:${jobTitle}`);
		
		if (!jobId){
			throw new Error(`Job ${jobTitle} not found}`);
		}

		await scheduler.cancelJob(jobId);
		await redis.del(`job:${jobTitle}`);

		logger.info(`Job: ${jobTitle} successfully canceled`);
		return { ok: true };

	} catch (err) {
		logger.error(`Failed to cancel job ${jobTitle}`, err);
		return { ok: false, reason: (err as Error).message };
	}
}