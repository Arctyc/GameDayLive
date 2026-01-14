import { Post, reddit } from "@devvit/web/server";
import { Logger } from './utils/Logger';

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

		// Attempt to sticky //TODO: only GDT?
		try {
			// TODO: use tryStickyThread()
			await post.sticky();
			logger.info(`Post sticky succeeded for ${context.subredditName}`);
		} catch (stickyErr) {
			logger.warn(`Failed to sticky post in ${context.subredditName}:`, stickyErr);
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

		//
        
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
export async function tryStickyThread(){

}

// TODO:
export async function tryUnstickyThread(){

}

// TODO:
export async function tryLockThread(){

}