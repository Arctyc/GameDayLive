import { JobContext, ScheduledJobEvent } from "@devvit/public-api";
import { getTodaysSchedule, getGameData } from "./api.js";
import { getSubredditConfig } from "../../core/config.js";

export async function dailyGameFinder(event: ScheduledJobEvent<any>, context: JobContext) {
  console.log("Running daily game finder...");
  
  try {
    // Get today's NHL schedule
    const games = await getTodaysSchedule(fetch);
    console.log(`Found ${games.length} games today`);
    
    // Get all subreddits with NHL configured
    // Note: We'll need to track installations separately
    // For now, we'll check the current subreddit only
    const config = await getSubredditConfig(context.subredditId, context);
    
    if (!config || !config.nhl || config.league !== "nhl") {
      console.log("No NHL config or NHL not active for this subreddit");
      return;
    }
    
    const teamAbbrev = config.nhl.teamAbbreviation;
    
    // Find games involving this team
    const teamGames = games.filter(
      game => game.awayTeam.abbrev === teamAbbrev || game.homeTeam.abbrev === teamAbbrev
    );
    
    console.log(`Found ${teamGames.length} games for team ${teamAbbrev}`);
    
    // Schedule pre-game threads for each game
    for (const game of teamGames) {
      const gameTime = new Date(game.startTimeUTC);
      const oneHourBefore = new Date(gameTime.getTime() - 60 * 60 * 1000);
      
      console.log(`Scheduling pre-game thread for game ${game.id} at ${oneHourBefore.toISOString()}`);
      
      await context.scheduler.runJob({
        name: "nhl_pregame_thread",
        data: {
          gameId: game.id,
          subredditId: context.subredditId,
        },
        runAt: oneHourBefore,
      });
    }
  } catch (error) {
    console.error("Error in daily game finder:", error);
  }
}

export async function pregameThread(event: ScheduledJobEvent<any>, context: JobContext) {
  console.log("Creating pre-game thread...");
  
  const { gameId, subredditId } = event.data as { gameId: number; subredditId: string };
  
  try {
    // TODO: Fetch game data and create thread
    console.log(`Would create pre-game thread for game ${gameId} in ${subredditId}`);
    
    // TODO: Schedule live update job
  } catch (error) {
    console.error("Error creating pre-game thread:", error);
  }
}

export async function liveUpdate(event: ScheduledJobEvent<any>, context: JobContext) {
  console.log("Running live update...");
  
  const { gameId, postId } = event.data as { gameId: number; postId: string };
  
  try {
    // Get stored ETag
    const etagKey = `game:${gameId}:etag`;
    const storedEtag = await context.redis.get(etagKey);
    
    // Fetch game data with ETag
    const { game, etag, modified } = await getGameData(gameId, fetch, storedEtag || undefined);
    
    if (!modified) {
      console.log("Game data not modified, skipping update");
    } else {
      // Store new ETag
      await context.redis.set(etagKey, etag);
      
      // TODO: Update the post with new game data
      console.log(`Would update post ${postId} for game ${gameId}`);
    }
    
    // Check game state
    const gameState = game.gameState || (modified ? game.gameState : "UNKNOWN");
    
    if (gameState === "FUT" || gameState === "LIVE" || gameState === "CRIT") {
      // Game is ongoing
      
      // Check if in intermission
      const periodDescriptor = game.periodDescriptor?.periodType;
      let nextRunDelay = 30 * 1000; // Default 30 seconds
      
      if (periodDescriptor === "SO" || periodDescriptor === "OT") {
        // Overtime or shootout - check more frequently
        nextRunDelay = 15 * 1000;
      } else if (game.period && game.periodDescriptor?.number) {
        // Could be in intermission - check if period is between periods
        // NHL typically has 18 minute intermissions
        // You'd need to parse game.clock or other fields to detect intermission precisely
        // For now, keep 30 second polling
      }
      
      // Schedule next update
      await context.scheduler.runJob({
        name: "nhl_live_update",
        data: { gameId, postId },
        runAt: new Date(Date.now() + nextRunDelay),
      });
      
    } else if (gameState === "OFF" || gameState === "FINAL") {
      // Game is over
      console.log(`Game ${gameId} is final`);
      
      // Check if should create post-game thread
      const config = await getSubredditConfig(context.subredditId, context);
      if (config?.nhl?.enablePostGameThreads) {
        // TODO: Create post-game thread
        console.log("Would create post-game thread");
      }
    }
    
  } catch (error) {
    console.error("Error in live update:", error);
  }
}