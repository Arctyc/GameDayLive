import { Devvit } from "@devvit/public-api";
import { getSubredditConfig } from "../../config.js";
import { NHL_TEAMS } from "./config.js";
import { NHLConfig } from "../../types.js";
import { dailyGameFinder, pregameThread, liveUpdate } from "./scheduler.js";

  export function registerNHLModule(devvit: typeof Devvit) {
    // Register scheduler jobs
    devvit.addSchedulerJob({
      name: "nhl_daily_game_finder",
      onRun: dailyGameFinder,
    });

    devvit.addSchedulerJob({
      name: "nhl_pregame_thread",
      onRun: pregameThread,
    });

    devvit.addSchedulerJob({
      name: "nhl_live_update",
      onRun: liveUpdate,
    });
  }