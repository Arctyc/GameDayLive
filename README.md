# GameDayLive

Automated game day and post-game thread bot for sports subreddits.

## Overview

GameDayLive automatically creates and updates live game threads for NHL teams (with support for more sports planned).

The bot:
- Posts game day threads 1 hour before puck drop
- Updates threads live with game details, goals, penalties, and scores every 30 seconds
- Creates post-game threads when games end (optional)

## Features

- **NHL Support**: Full integration with the NHL API for real-time game data
- **Modular Design**: Easily extensible for NFL, NBA, MLB, and other leagues
- **Per-Subreddit Configuration**: Each subreddit selects their league, team, and preferences

## Installation

Note: installation and configuration is not compatible with old reddit, but the bot is!

Moderators can install GameDayLive from the Reddit Apps directory:

1. From your subreddit, click Mod Tools
2. select Browse Apps on the left sidebar
3. Search for and select "GameDayLive" and "+ Add to community"

After installation, easily configure the bot:

1. Click the subreddit menu (three dots next to Mod Tools)
2. Select "Configure GameDayLive"
3. Choose your team and preferences

That's it! 
The bot will now automatically create game day and (optionally) post-game threads for your chosen team.

## Development

### Prerequisites

- Node.js 18+
- npm
- Devvit CLI (`npm install -g devvit`)

### Setup
```bash
# Clone the repository
git clone https://github.com/Arctyc/gamedaylive.git
cd gamedaylive

# Install dependencies
npm install

# Login to Devvit
devvit login

# Test locally
devvit playtest your-test-subreddit
```

### Project Structure
```
src/
├── main.ts                # App orchestrator
├── types.ts               # Shared TypeScript types
├── threads.ts             # Unified thread-posting
├── core/
│   └── config.ts          # Config storage utilities
└── leagues/
    └── nfl/               # NFL module registration - Contribute to implement this league
    └── nhl/
        ├── api.ts         # NHL API client
        ├── config.ts      # NHL team data
        ├── constants.ts   # NHL global constants
        ├── formatter.ts   # NHL Thread formatting
        ├── index.ts       # NHL module registration
        ├── scheduler.ts   # NHL process automation
```

### Adding a New League

1. Create `src/leagues/{league}/` directory
2. Implement config, API client, scheduler, formatter
3. Register module in `src/main.ts`
4. Add league config to `src/types.ts`

## Roadmap

- [x] NHL support (WIP)
- [ ] More sports/leagues
- [ ] Customizable thread templates?
- [ ] Your desired features? Contribute!

## Contributing

Contributions welcome! Please open an issue or submit a pull request.

## License

GPL-3.0

## Credits

Built with [Devvit](https://developers.reddit.com/docs) - Reddit's Developer Platform

Game data provided by:
- NHL: https://api-web.nhle.com/