import { Post, PostSuggestedCommentSort, reddit } from "@devvit/web/server";
import { redis } from '@devvit/redis';
import { scheduler } from '@devvit/web/server';
import { Logger } from './utils/Logger';
import { REDIS_KEYS } from "./leagues/nhl/constants";
import { APPNAME } from "./types";

// Create new thread
export async function tryCreateThread(
	context: any,
	title: string,
	body: string,
	sticky: boolean,
	sort: 'new' | 'best',
): Promise<{ success: boolean; post?: Post; error?: string }> {
	const logger = await Logger.Create('Thread - Create');

	const bodyWithFooter = appendFooter(body);

	try {
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

To see more, report a bug, or contribute to the project, please visit [the github page](<https://github.com/Arctyc/GameDayLive>).`
		);
		// -------- END TEMP COMMENT --------

		// Set comment sort
		try {
			await post.setSuggestedCommentSort(sort.toUpperCase() as PostSuggestedCommentSort);
			logger.info(`Post sort set to ${sort} for ${post.id}`);
		} catch (sortErr) {
			logger.warn(`Failed to set comment sort on post ${post.id}:`, sortErr);
		}

		await tryStickyThread(post, sticky);

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

	try {
		const post = await reddit.getPostById(postId);
		if (!post) {
			logger.error(`Cannot find post ${postId}`);
			return {
				success: false,
				error: `Post ${postId} not found`,
			};
		}

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
	return body += `\n\n---\n\n[GameDayLive](https://developers.reddit.com/apps/gamedaylive) is an [open source project](<https://github.com/Arctyc/GameDayLive>) that is not affiliated with any organization.`;
}

export async function tryAddComment(post: Post, comment: string) {
	const logger = await Logger.Create('Thread - Add comment');

	try {
		await post.addComment({ text: comment });
		logger.info(`Comment added to post ${post.id}`);
	} catch (err) {
		logger.warn(`Failed to add comment to post ${post.id}:`, err);
	}
}

export async function tryStickyThread(post: Post, enabled: boolean) {
	const logger = await Logger.Create('Thread - Sticky');

	// Ensure app is author of post
	if (post.authorName !== APPNAME) {
		logger.warn(`Tried to sticky un-owned post.`);
		return;
	}

	if (!enabled) {
		logger.info(`Sticky not enabled for post ${post.id}, skipping.`);
		return;
	}

	try {
		if (post.isStickied()) {
			logger.warn(`Post ${post.id} is already stickied.`);
			return;
		}

		await post.sticky();
		logger.info(`Post ${post.id} successfully stickied.`);

	} catch (err) {
		logger.error(`Error trying to sticky post ${post.id}:`, err);
	}
}

export async function tryUnstickyThread(post: Post) {
	const logger = await Logger.Create('Thread - Unsticky');

	// Ensure app is author of post
	if (post.authorName !== APPNAME) {
		logger.warn(`Tried to unsticky un-owned post.`);
		return;
	}

	try {
		if (!post.isStickied()) {
			logger.warn(`Post ${post.id} is not stickied.`);
			return;
		}

		await post.unsticky();
		logger.info(`Post ${post.id} successfully unstickied.`);

	} catch (err) {
		logger.error(`Error trying to unsticky post ${post.id}:`, err);
	}
}

export async function tryLockThread(post: Post, enabled: boolean) {
	const logger = await Logger.Create('Thread - Lock');

	// Ensure app is author of post
	if (post.authorName !== APPNAME) {
		logger.warn(`Tried to lock un-owned post.`);
		return;
	}

	if (!enabled) {
		logger.info(`Locking not enabled for post ${post.id}, skipping.`);
		return;
	}

	try {
		if (post.isLocked()) {
			logger.warn(`Post ${post.id} is already locked.`);
			return;
		}

		await post.lock();
		logger.info(`Post ${post.id} locked.`);

	} catch (err) {
		logger.error(`Error trying to lock post ${post.id}:`, err);
	}
}

export async function tryCleanupThread(
	postId: Post["id"],
	lock: boolean,
): Promise<{ success: boolean; postId?: string; error?: string }> {
	const logger = await Logger.Create('Thread - Cleanup');

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

		await tryUnstickyThread(post);
		await tryLockThread(post, lock);

		// Get scheduled job ID
		const gameIdForGDT = await redis.get(REDIS_KEYS.THREAD_TO_GAME_ID(postId));
		const gameIdForPGT = await redis.get(REDIS_KEYS.PGT_TO_GAME_ID(postId));

		// Prefer PGT mapping first
		if (gameIdForPGT) {
			const gameId = Number(gameIdForPGT);

			const pgtCreateJobId = await redis.get(REDIS_KEYS.JOB_POSTGAME(gameId));
			if (pgtCreateJobId) {
				await tryCancelScheduledJob(pgtCreateJobId);
				await redis.del(REDIS_KEYS.JOB_POSTGAME(gameId));
			}

			const pgtCleanupJobId = await redis.get(REDIS_KEYS.JOB_PGT_CLEANUP(gameId));
			if (pgtCleanupJobId) {
				await tryCancelScheduledJob(pgtCleanupJobId);
				await redis.del(REDIS_KEYS.JOB_PGT_CLEANUP(gameId));
			}

			const pgtUpdateJobId = await redis.get(REDIS_KEYS.JOB_PGT_UPDATE(gameId));
			if (pgtUpdateJobId) {
				await tryCancelScheduledJob(pgtUpdateJobId);
				await redis.del(REDIS_KEYS.JOB_PGT_UPDATE(gameId));
			}

			await redis.del(REDIS_KEYS.GAME_TO_PGT_ID(gameId));
			await redis.del(REDIS_KEYS.PGT_TO_GAME_ID(postId));

			logger.info(`PGT ${postId} cleaned up.`);
		} else if (gameIdForGDT) {
			const gameId = Number(gameIdForGDT);

			const gdtCreateJobId = await redis.get(REDIS_KEYS.JOB_CREATE(gameId));
			if (gdtCreateJobId) {
				await tryCancelScheduledJob(gdtCreateJobId);
				await redis.del(REDIS_KEYS.JOB_CREATE(gameId));
			}

			const updateJobId = await redis.get(REDIS_KEYS.JOB_GDT_UPDATE(gameId));
			if (updateJobId) {
				await tryCancelScheduledJob(updateJobId);
				await redis.del(REDIS_KEYS.JOB_GDT_UPDATE(gameId));
			}

			await redis.del(REDIS_KEYS.GAME_TO_THREAD_ID(gameId));
			await redis.del(REDIS_KEYS.THREAD_TO_GAME_ID(postId));
			await redis.del(REDIS_KEYS.GAME_ETAG(gameId));

			logger.info(`GDT ${postId} cleaned up.`);
		} else {
			logger.warn(`No Redis mapping found for post: ${postId}`);
		}

		return { success: true, postId };

	} catch (err) {
		logger.error(`Failed to clean up post ${postId}:`, err);
		return { success: false, error: String(err) };
	}
}

// TODO: Feature/option: Add thread menu to devvit.json to cancel live updates from thread
export async function tryCancelScheduledJob(jobId: string) {
	const logger = await Logger.Create('Thread - Cancel Job');

	try {
		await scheduler.cancelJob(jobId);
		await redis.del(`job:${jobId}`);

		logger.info(`Job ${jobId} successfully canceled`);
		return { ok: true };

	} catch (err) {
		const errorMsg = (err as Error).message;
		if (errorMsg.includes('not found')) {
			logger.warn(`Job ${jobId} not found (already completed or never existed)`);
			await redis.del(`job:${jobId}`);
			return { ok: true };
		}
		logger.error(`Failed to cancel job ${jobId}`, err);
		return { ok: false, reason: (err as Error).message };
	}
}

/* // Disabled due to non-functioning reddit.getNewPosts()
export async function findRecentThreadByName(threadTitle: string): Promise<Post | undefined > {
	const logger = await Logger.Create(`Thread - Find By Name`);

	const recentThreads = await reddit.getNewPosts({
		subredditName: context.subredditName,
		limit: 500,
	})

	// DEBUG
	logger.info(`Searching for title: "${threadTitle}"`);
	logger.info(`Total posts fetched: ${recentThreads.children?.length || 0}`);
	recentThreads.children?.forEach((t, i) => {
		logger.info(`Post ${i}: "${t.title}"`);
		logger.info(`Match: ${t.title === threadTitle}`);
	});
	// END DEBUG

	const post = recentThreads.children?.find(t => t.title === threadTitle);
	
	if (post){
		logger.info(`Found post: ${post?.id}`);
		return post
	} else {
		logger.info(`No recent post matching name ${threadTitle}`);
		return undefined;
	}
}
*/