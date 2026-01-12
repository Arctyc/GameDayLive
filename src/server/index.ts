import { createServer, getServerPort, context } from '@devvit/web/server';
import { LEAGUES } from './types';
import { NHL_TEAMS } from './leagues/nhl/config.js';
import * as nhl from './leagues/nhl/index.js';
//import { handleConfigSubmit } from "./server/config.js";
import express from "express";

// Set up express
const app = express();
app.use(express.json());

// Register scheduler jobs
nhl.registerNHLModule;

// CHECK/FIX: Add menu for moderators to configure the bot
app.post('/internal/config-menu', (req, res) => {
  const selectedLeague = req.body.values?.league || LEAGUES[0];
  
  // Map league to teams
  const leagueTeams: Record<string, Array<{label: string, value: string}>> = {
    nhl: NHL_TEAMS.map(team => ({ label: team.label, value: team.value })),
    // mlb: MLB_TEAMS.map(team => ({ label: team.label, value: team.value })),
    // nfl: NFL_TEAMS.map(team => ({ label: team.label, value: team.value })),
    // nba: NBA_TEAMS.map(team => ({ label: team.label, value: team.value })),
  };

  const teamOptions = leagueTeams[selectedLeague] || [];

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
            options: LEAGUES.map((l: typeof LEAGUES[number]) => ({
            label: l.toUpperCase(),
            value: l
            })),
            onValueChanged: 'refresh',
          },
          {
            type: 'select',
            name: 'team',
            label: 'Team',
          },
          {
            type: 'boolean',
            name: 'enablePostgameThreads',
            label: 'Enable post-game threads',
            defaultValue: true,
          }
        ],
        acceptLabel: 'Save',
      },
    },
  });
});

// TODO: Save form data


const server = createServer(app);
server.listen(getServerPort());