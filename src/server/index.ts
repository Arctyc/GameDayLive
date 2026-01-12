import { reddit } from '@devvit/web/server';
import { handleConfigSubmit, getSubredditConfig, setSubredditConfig } from './config.js';
import * as nhl from '../leagues/nhl/index.js';

// Register scheduler jobs?
nhl.registerNHLModule;

// TODO: Add menu for moderators to configure the bot
