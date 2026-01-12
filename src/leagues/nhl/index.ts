import { getSubredditConfig } from "../../server/config.js";
import { NHL_TEAMS } from "./config.js";
import { NHLConfig } from "../../types.js";
import { createServer, getServerPort, context } from "@devvit/server";
import { dailyGameFinder, pregameThread, liveUpdate } from "./scheduler.js";
import { handleConfigSubmit } from "../../server/config.js";
import express from "express";

// Set up express
const app = express();
app.use(express.json());

// Subreddit config endpoint
app.post("/api/config", async (req, res) => {
  const { formData } = req.body;
  await handleConfigSubmit(context, formData);
  res.status(200).json({ success: true });
});

// TODO: Register NHL schedulers
export function registerNHLModule() {
  // TODO: nhl_daily_game_finder
  // TODO: nhl_pregame_thread
  // TODO: nhl_live_update
}