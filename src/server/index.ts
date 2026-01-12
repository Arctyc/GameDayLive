import { Devvit } from '@devvit/public-api';
import { registerNHLModule } from '../leagues/nhl/index.js';
//import { getSubredditConfig, setSubredditConfig } from '../../config.js';
//import { NHL_TEAMS } from '../leagues/nhl/config.js';

Devvit.configure({
  redditAPI: true,
  redis: true,
  http: true,
});

// Register NHL scheduler jobs
registerNHLModule(Devvit);

// Add menu item for moderators to configure the bot
Devvit.addMenuItem({
  location: 'subreddit',
  label: 'GameDayLive Config',
  forUserType: 'moderator',
  onPress: async (event, context) => {
    context.ui.showToast('Menu action clicked!');
  },
});

export default Devvit;