import { JobContext, ScheduledJobEvent } from "@devvit/public-api";
import { getTodaysSchedule, getGameData, NHLGame } from "./api.js";
import { getSubredditConfig } from "../../core/config.js";
import { UPDATE_INTERVALS, REDIS_KEYS, GAME_STATES } from "./constants.js";
import { } from "./threads.js";

export async function dailyGameFinder(event: ScheduledJobEvent<any>, context: JobContext) {
  console.log("Running daily game finder...");
  
  try {
    const config = await getSubredditConfig(context.subredditId, context);

    const games = await getTodaysSchedule(fetch);
    console.log(`Found ${games.length} games today`);  
    
    if (!config || !config.nhl || config.league !== "nhl") {
      console.log("No NHL config or NHL not active for this subreddit");
      return;
    }
    
    // Find games involving the selected team
    const teamAbbrev = config.nhl.teamAbbreviation;
    const teamGames = games.filter(
      game => game.awayTeam.abbrev === teamAbbrev || game.homeTeam.abbrev === teamAbbrev
    );
    
    console.log(`Found ${teamGames.length} games for team ${teamAbbrev}`);
    
    // Schedule pre-game threads for each game
    for (const game of teamGames) {
      const gameTime = new Date(game.startTimeUTC);
      const oneHourBefore = new Date(gameTime.getTime() - UPDATE_INTERVALS.PREGAME_THREAD_OFFSET);
      
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
    console.log(`Would create pre-game thread for game ${gameId} in ${context.subredditName}`);
    
    // TODO: Schedule live update job
    console.log(`Would schedule live update job`);

  } catch (error) {
    console.error("Error creating pre-game thread:", error);
  }
}

export async function liveUpdate(event: ScheduledJobEvent<any>, context: JobContext) {
  console.log("Running live update...");
  
  const { gameId, postId } = event.data as { gameId: number; postId: string };
  
  try {
    const etagKey = REDIS_KEYS.GAME_ETAG(gameId);
    const stateKey = REDIS_KEYS.GAME_STATE(gameId);
    const storedEtag = await context.redis.get(etagKey);
    
    const { game, etag, modified } = await getGameData(gameId, fetch, storedEtag || undefined);
    
    if (modified) {
      await context.redis.set(etagKey, etag);
      await context.redis.set(stateKey, game.gameState || GAME_STATES.UNKNOWN);
      await handleGameUpdate(game, gameId, postId, context);
      await scheduleNextUpdate(game, gameId, postId, context);
    } else {
      console.log("Game data not modified, skipping update");
      const cachedState = await context.redis.get(stateKey);
      await scheduleNextUpdate({ gameState: cachedState } as NHLGame, gameId, postId, context);
    }
    
  } catch (error) {
    console.error("Error in live update:", error);
  }
}

async function handleGameUpdate(
  game: NHLGame, 
  gameId: number, 
  postId: string, 
  context: JobContext
) {
  console.log(`Updating post ${postId} for game ${gameId}`);
  
  const gameState = game.gameState || GAME_STATES.UNKNOWN;
  
  if (gameState === GAME_STATES.LIVE || gameState === GAME_STATES.CRIT || gameState === GAME_STATES.FINAL) {    
    // TODO: Update thread with new game data
    console.log(`Would update thread content for ${gameState} game`);
    
  } else if (gameState === GAME_STATES.OFF) {
    console.log(`Game ${gameId} is OFF`);
    
    const config = await getSubredditConfig(context.subredditId, context);
    if (config?.nhl?.enablePostGameThreads) {
      // TODO: Create post-game thread
      console.log(`Would create post-game thread for game ${gameId} in ${context.subredditName}`);
      
    }
  }
}

async function scheduleNextUpdate(
  game: NHLGame,
  gameId: number,
  postId: string,
  context: JobContext
) {
  const gameState = game.gameState || GAME_STATES.UNKNOWN;
  
  if (gameState === GAME_STATES.LIVE || gameState === GAME_STATES.CRIT) {
    const periodDescriptor = game.periodDescriptor?.periodType;
    
    let nextRunDelay = UPDATE_INTERVALS.LIVE_GAME_DEFAULT;
    
    if (periodDescriptor === "SO" || periodDescriptor === "OT") {
      nextRunDelay = UPDATE_INTERVALS.OVERTIME_SHOOTOUT;
    }
    
    await context.scheduler.runJob({
      name: "nhl_live_update",
      data: { gameId, postId },
      runAt: new Date(Date.now() + nextRunDelay),
    });
    
    console.log(`Next update scheduled in ${nextRunDelay / 1000}s`);

  } else if (gameState === GAME_STATES.FINAL || gameState === GAME_STATES.OFF) {
    console.log("Game is over, not scheduling another update.");
  }
}