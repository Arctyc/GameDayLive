import { context, Post, reddit } from "@devvit/web/server";
import { redis } from '@devvit/redis';
import { scheduler } from '@devvit/web/server';
import { Logger } from './utils/Logger';
import { REDIS_KEYS } from "./leagues/nhl/constants";

//TODO: Implement optional sticky status of both GDT and PGT

// Create new thread
export async function tryCreateThread(
	context: any,
	title: string,
	body: string
): Promise<{ success: boolean; post?: Post; error?: string }> {
	const logger = await Logger.Create('Thread - Create');

	const bodyWithFooter = appendFooter(body);

	try {
    	// Submit post create request
		const post = await reddit.submitPost({
			subredditName: context.subredditName,
			title: title,
			text: bodyWithFooter,
		});

		logger.info(`Post created in ${context.subredditName} with title: "${title}"`);

		// HACK: Temporary comment - remove for v1.0
		await tryAddComment(
			post,
`This thread was created by GameDayLive, an application that is in active development.  
GameDayLive is currently testing its features and performance in this subreddit. We appreciate your patience in the event of any issues.  

To see more, report a bug, or contribute to the project, please visit [the github page](https://github.com/Arctyc/GameDayLive).`
		);
		// -------- END TEMPORT COMMENT --------

		// Attempt to sort by new
		try {
			await post.setSuggestedCommentSort("NEW");
			logger.info(`Post sort by new succeeded for ${post.id}`)
		} catch (sortNewErr) {
			logger.warn(`Failed to set sort by new on post: ${post.id}:`, sortNewErr);
		}

		// Sticky
		await tryStickyThread(post);

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

  	const bodyWithFooter = appendFooter(body);

	// Ensure thread exists
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
		await post.edit({ text: bodyWithFooter });
		logger.info(`Post ${postId} successfully updated.`);
	} catch (err) {
		logger.error(`Failed to edit post ${postId}:`, err);
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
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

export function appendFooter(body: string) {
	return body += `\n\n---\n\n[GameDayLive](https://developers.reddit.com/apps/gamedaylive) is an [open source project](https://github.com/Arctyc/GameDayLive) that is not affiliated with any organization.`;
}

export async function tryAddComment(post: Post, comment: string){
	const logger = await Logger.Create('Thread - Add comment');

	try {
		await post.addComment({
			text: comment
		});

		logger.info(`Post comment added to post ${post.id}`);
	} catch (err) {
		logger.warn(`Failed to add comment to post ${post.id}:`, err);
	}
}

export async function tryStickyThread(post: Post){
	const logger = await Logger.Create(`Thread - Sticky`);

	// TODO: If not enabled in subredditconfig, return

	try {
		if (await post.isStickied) {
			logger.warn(`Post: ${post.id} is already stickied.`);
			return;
		}

		await post.sticky();
	} catch (err) {
		logger.error(`Error trying to sticky post: ${post.id}`, err);
	}

}

export async function tryUnstickyThread(post: Post){
	const logger = await Logger.Create(`Thread - Unsticky`);

	try {
		if (!await post.isStickied) {
			logger.warn(`Post: ${post.id} is not stickied.`);
			return;
		}

		await post.unsticky();
	} catch (err) {
		logger.error(`Error trying to unstucky post: ${post.id}`, err);
	}
}


export async function tryLockThread(post: Post){
	const logger = await Logger.Create(`Thread - Lock`);

	// TODO: If not enabled in subredditconfig, return
	
	try {
		if (await post.isLocked) {
			logger.warn(`Post: ${post.id} is already locked.`);
			return;
		}

		await post.lock();
	} catch (err) {
		logger.error(`Error trying to lock post: ${post.id}`, err);
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
        await tryUnstickyThread(post);
		
		// Lock post
        //await tryLockPost(); NOTE: Is this wanted? (add to config options?)

		// Get scheduled job ID 
		const gameIdForGDT = await redis.get(REDIS_KEYS.THREAD_TO_GAME_ID(postId));
        const gameIdForPGT = await redis.get(REDIS_KEYS.PGT_TO_GAME_ID(postId));

        // Handle Game Day Thread Cleanup
        if (gameIdForGDT) {
            const gameId = Number(gameIdForGDT);
            
            // Cancel the update loop for this thread
            const updateJobId = await redis.get(REDIS_KEYS.JOB_GDT_UPDATE(gameId));
            if (updateJobId) {
                await tryCancelScheduledJob(updateJobId);
                await redis.del(REDIS_KEYS.JOB_GDT_UPDATE(gameId));
            }

            // Wipe Redis
            await redis.del(REDIS_KEYS.GAME_TO_THREAD_ID(gameId));
            await redis.del(REDIS_KEYS.THREAD_TO_GAME_ID(postId));
            await redis.del(REDIS_KEYS.GAME_ETAG(gameId));
            
            logger.info(`GDT ${postId} cleaned up.`);
        } 
        
        // Handle Post-Game Thread Cleanup
        else if (gameIdForPGT) {
            const gameId = Number(gameIdForPGT);
            
            // Cancel any updates
            const pgtJobId = await redis.get(REDIS_KEYS.JOB_POSTGAME(gameId));
            if (pgtJobId) {
                await tryCancelScheduledJob(pgtJobId);
                await redis.del(REDIS_KEYS.JOB_POSTGAME(gameId));
            }

            // Wipe Redis
            await redis.del(REDIS_KEYS.GAME_TO_PGT_ID(gameId));
            await redis.del(REDIS_KEYS.PGT_TO_GAME_ID(postId));
            
            logger.info(`PGT ${postId} cleaned up.`);
        } 
        else {
            logger.warn(`No Redis mapping found for post: ${postId}`);
        }

        return { success: true, postId };
    } catch (err) {
        logger.error(`Failed to clean up post ${postId}:`, err);
        return { success: false, error: String(err) };
    }
}

// TODO: Feature/option: Add thread menu to devvit.json to cancel live updates from thread
export async function tryCancelScheduledJob(jobId: string){ 
	const logger = await Logger.Create('Thread - Cancel Job');
	
	try{
		
		await scheduler.cancelJob(jobId);
		await redis.del(`job:${jobId}`);

		logger.info(`Job: ${jobId} successfully canceled`);
		return { ok: true };

	} catch (err) {
		logger.error(`Failed to cancel job ${jobId}`, err);
		return { ok: false, reason: (err as Error).message };
	}
}

export async function findRecentThreadByName(threadTitle: string): Promise<Post | undefined > {
	const logger = await Logger.Create(`Thread - Find By Name`);

	const recentThreads = await reddit.getNewPosts({
		subredditName: context.subredditName,
		limit: 500,
	})

	const post = recentThreads.children?.find(t => t.title === threadTitle);
	
	if (post){
		logger.info(`Found post: ${post?.id}`);
		return post
	} else {
		logger.info(`No recent post matching name ${threadTitle}`);
		return undefined;
	}
}