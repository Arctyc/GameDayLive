import { getSubredditConfig } from "../../server/config.js";
import { NHL_TEAMS } from "./config.js";
import { NHLConfig } from "../../types.js";
import { createServer, getServerPort, context } from "@devvit/server";
import { dailyGameFinder, pregameThread, liveUpdate } from "./scheduler.js";

// Register NHL schedulers
export function registerNHLModule() {
  // TODO: nhl_daily_game_finder
  // TODO: nhl_pregame_thread
  // TODO: nhl_live_update
}