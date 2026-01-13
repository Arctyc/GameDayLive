import { redis, reddit } from '@devvit/web/server';
import { getTodaysSchedule, getGameData, NHLGame } from './api';
import { formatThreadTitle, formatThreadBody } from './formatter';
import { UPDATE_INTERVALS, GAME_STATES, REDIS_KEYS } from './constants';
import { SubredditConfig } from '../../types';

// Get SubredditConfig
export async function getSubredditConfig(subredditName: string): Promise<SubredditConfig | null> {
    const configStr = await redis.hGet('subredditConfig', subredditName);
    if (!configStr) return null;
    return JSON.parse(configStr) as SubredditConfig;
}

// --------------- Daily Game Check -----------------
export async function dailyGameCheckJob(subredditName: string) {
    const config = await getSubredditConfig(subredditName);
    if (!config || !config.nhl) return; // subreddit not configured or no NHL team

    const teamAbbrev = config.nhl.teamAbbreviation;

    const todayGames = await getTodaysSchedule(fetch);

    // Filter by the subreddit’s NHL team
    const game = todayGames.find(
        g => g.homeTeam.abbrev === teamAbbrev || g.awayTeam.abbrev === teamAbbrev
    );

    if (!game) return; // no game for this team today

    // Schedule the game thread 1 hour before start
    const startTime = new Date(game.startTimeUTC).getTime();
    const scheduleTime = startTime - UPDATE_INTERVALS.PREGAME_THREAD_OFFSET;

    await scheduleCreateGameThread(game.id, subredditName, scheduleTime);
    }

// --------------- Create Game Thread -----------------
export async function createGameThreadJob(gameId: number, subredditName: string) {
    // Fetch game data
    const { game } = await getGameData(gameId, fetch);

    // Format title & body
    const title = await formatThreadTitle(game, subredditName);
    const body = await formatThreadBody(game, subredditName);

    // TODO: create thread on reddit with subredditName, title, body

    // Store threadId in Redis for later updates // TODO: ensure cleared at some point
    // await redis.set(`game:${gameId}:threadId`, post.id); // FIX: Temporarily disabled while no post.id to store

    // Schedule first live update 60 seconds before start
    const startTime = new Date(game.startTimeUTC).getTime();
    const firstUpdateTime = startTime - 60 * 1000;
    await scheduleNextLiveUpdate(game, subredditName, firstUpdateTime);
}

// --------------- Next Live Update -----------------
export async function nextLiveUpdateJob(gameId: number, subredditName: string) {
    const threadId = await redis.get(`game:${gameId}:threadId`);
    if (!threadId) return;

    const { game, modified } = await getGameData(gameId, fetch, await redis.get(REDIS_KEYS.GAME_ETAG(gameId)));

    // Update the ETag in Redis
    if (modified) await redis.set(REDIS_KEYS.GAME_ETAG(gameId), game.id.toString());

    // Format update text
    const body = await formatThreadBody(game, subredditName);

    // TODO: update post
    // 

    // Schedule next live update
    if (game.gameState !== GAME_STATES.FINAL) {
        let nextUpdateDelay = UPDATE_INTERVALS.LIVE_GAME_DEFAULT;
        // TODO: if intermission, adjust to INTERMISSION interval
        await scheduleNextLiveUpdate(game, subredditName, Date.now() + nextUpdateDelay);
    } else {
        // Game finished
        // TODO: schedule postgame thread if enabled
        // TODO: clear any existing data?
    }
}

// --------------- Scheduling helpers -----------------
async function scheduleCreateGameThread(gameId: number, subredditName: string, time: number) {
  // TODO: call Devvit scheduler API to schedule create-game-thread at `time`
}

async function scheduleNextLiveUpdate(game: NHLGame, subredditName: string, time: number) {
  // TODO: call Devvit scheduler API to schedule next-live-update at `time`
}
