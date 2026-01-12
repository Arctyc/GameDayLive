import { createServer, getServerPort } from '@devvit/web/server';
import * as nhl from '../leagues/nhl/index.js';
import { NHL_TEAMS } from '../leagues/nhl/config.js';
import { handleConfigSubmit } from "../server/config.js";
import express from "express";

// Set up express
const app = express();
app.use(express.json());

// Register scheduler jobs
nhl.registerNHLModule;

// FIX: Add menu for moderators to configure the bot
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
            options: [
              { label: 'NHL', value: 'nhl' }
            ],
            defaultValue: ['nhl'],
          },
          {
            type: 'select',
            name: 'team',
            label: 'Team',
            options: NHL_TEAMS.map(team => ({
              label: team.label, 
              value: team.value 
            })),
          },
          {
            type: 'boolean',
            name: 'enablePostgameThreads',
            label: 'Enable post-game threads',
            defaultValue: true,
          }
        ],
        acceptLabel: 'Save Settings',
      },
    },
  });
});

// Subreddit config endpoint
app.post("/api/config", async (req, res) => {
  const { formData } = req.body;
  await handleConfigSubmit(context, formData);
  res.status(200).json({ success: true });
});

const server = createServer(app);
server.listen(getServerPort());