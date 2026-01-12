import { Devvit } from '@devvit/public-api';
import { registerNHLModule } from '../leagues/nhl/index.js';
import { getSubredditConfig, setSubredditConfig } from '../../config.js';
import { NHL_TEAMS } from '../leagues/nhl/config.js';

Devvit.configure({
  redditAPI: true,
  redis: true,
});

// =============================================================================
// TODO: Register NHL scheduler jobs
// =============================================================================
// This calls registerNHLModule() which registers three scheduler jobs:
// - nhl_daily_game_finder: Runs daily to find games for your team
// - nhl_pregame_thread: Creates pre-game thread 1 hour before game
// - nhl_live_update: Updates game thread during live games
// These are already implemented in leagues/nhl/scheduler.ts
registerNHLModule(Devvit);

// =============================================================================
// TODO: Handle communication from public/index.html
// =============================================================================
// The frontend (public/index.html) will send messages to the server.
// You need to handle two message types:
//
// Message 1: { type: 'getConfig' }
//   - Called when public/index.html loads
//   - Should: Call getSubredditConfig() to get saved config from Redis
//   - Should: Return { type: 'configData', teams: NHL_TEAMS, config: {...} }
//   - Purpose: Populate the form with teams dropdown and existing config
//
// Message 2: { type: 'saveConfig', data: { team: 'BOS', postGameThreads: true } }
//   - Called when user submits the form
//   - Should: Call setSubredditConfig() to save to Redis
//   - Should: Trigger the scheduler with context.scheduler.runJob()
//   - Should: Show toast with context.ui.showToast()
//   - Should: Return { type: 'saveSuccess' }
//   - Purpose: Save config and start the automated game finder
//
// FIND THE CORRECT DEVVIT API FOR THIS. Examples of what to search:
// - "Devvit receive message from webview"
// - "Devvit post server communication"
// - Look at reddit/devvit-template-web-view-post on GitHub
//
// Placeholder structure (REPLACE WITH REAL API):
// SomeDevvitAPI.handleMessage(async (message, context) => {
//   if (message.type === 'getConfig') {
//     const config = await getSubredditConfig(context.subredditId, context);
//     return { type: 'configData', teams: NHL_TEAMS, config };
//   }
//   if (message.type === 'saveConfig') {
//     await setSubredditConfig(context.subredditId, {
//       league: 'nhl',
//       nhl: {
//         teamAbbreviation: message.data.team,
//         enablePostGameThreads: message.data.postGameThreads,
//       }
//     }, context);
//     await context.scheduler.runJob({
//       name: 'nhl_daily_game_finder',
//       data: {},
//       runAt: new Date(),
//     });
//     context.ui.showToast('Configuration saved!');
//     return { type: 'saveSuccess' };
//   }
// });

// =============================================================================
// TODO: Add menu item for moderators to configure the bot
// =============================================================================
// When a moderator clicks this menu item:
// 1. Get the current subreddit with context.reddit.getCurrentSubreddit()
// 2. Create a new post with context.reddit.submitPost()
//    - Title: Something like "GameDayLive Configuration"
//    - This post will automatically render public/index.html (configured in devvit.json)
// 3. Navigate to the post with context.ui.navigateTo(post)
//


// This creates a post that shows your configuration form.
Devvit.addMenuItem({
  location: 'subreddit',
  label: 'Configure GameDayLive',
  description: 'Set your league, team, and preferences',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    // TODO: stuff
  },
});

export default Devvit;