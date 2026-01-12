import { createServer, getServerPort } from '@devvit/web/server';
import { LEAGUES } from '../types.js';
import { NHL_TEAMS } from '../leagues/nhl/config.js';
import * as nhl from '../leagues/nhl/index.js';
import { handleConfigSubmit } from "../server/config.js";
import express from "express";

// Set up express
const app = express();
app.use(express.json());

// Register scheduler jobs
nhl.registerNHLModule;

// CHECK/FIX: Add menu for moderators to configure the bot
app.post('/internal/config-menu', (req, res) => {
  res.json({
    showForm: {
      name: 'configForm',
      form: {
        title: 'GameDayLive Configuration',
        fields: [
          {
            type: 'select',
            name: 'league',
            label: 'League',
            options: LEAGUES.map(l => ({
              label: l.toUpperCase(),
              value: l
            })),
          },
          {
            type: 'select',
            name: 'team',
            label: 'Primary Team',
            options: NHL_TEAMS.map(team => ({
              label: team.label,
              value: team.value
            })),
          },
          {
            type: 'boolean',
            name: 'enablePostgameThreads',
            label: 'Enable Post-Game Threads',
            defaultValue: true,
          }
        ],
        acceptLabel: 'Save Settings',
      },
    },
  });
});

// Subreddit config endpoint
// TODO: set up context? where get subreddit name?
app.post("/api/config", async (req, res) => {
  const { formData } = req.body;
  await handleConfigSubmit(context, formData);
  res.status(200).json({ success: true });
});

const server = createServer(app);
server.listen(getServerPort());