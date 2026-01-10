# GameDayLive

Automated game day and post-game thread bot for sports subreddits.

## Overview

GameDayLive automatically creates and updates live game threads for NHL teams (with support for more sports planned). The bot:

- Posts game day threads 1 hour before puck drop
- Updates threads live with goals, penalties, and scores every 30 seconds
- Creates post-game threads when games end

## Features

- **NHL Support**: Full integration with the NHL API for real-time game data
- **Modular Design**: Easily extensible for NFL, NBA, MLB, and other sports
- **Per-Subreddit Configuration**: Each subreddit selects their team and preferences

## Installation

Moderators can install GameDayLive from the Reddit Apps directory:

1. Go to your subreddit's Mod Tools
2. Navigate to Apps
3. Search for "GameDayLive"
4. Click Install
5. Configure your team preferences

## Configuration

After installation, moderators can configure the bot:

1. Click the subreddit menu (three dots)
2. Select "Configure GameDayLive"
3. Choose your team and preferences

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
├── core/
│   └── config.ts          # Config storage utilities
└── sports/
    └── nfl/               # NFL module registration - Not implemented
    └── nhl/
        ├── index.ts       # NHL module registration
        ├── config.ts      # NHL team data
        ├── api.ts         # NHL API client
        ├── scheduler.ts   # Scheduler jobs
        └── threads.ts     # Thread formatting (coming soon)
```

### Adding a New Sport

1. Create `src/sports/{sport}/` directory
2. Implement API client, scheduler, and config
3. Register module in `src/main.ts`
4. Add sport config to `src/types.ts`

## Roadmap

- [x] NHL support
- [x] Modular architecture
- [ ] Thread creation and formatting
- [ ] Post-game threads
- [ ] Customizable thread templates
- [ ] NFL support
- [ ] More sports
- [ ] Your desired features? Contribute!

## Contributing

Contributions welcome! Please open an issue or submit a pull request.

## License



## Credits

Built with [Devvit](https://developers.reddit.com/docs) - Reddit's Developer Platform

Game data provided by:
- NHL: https://api-web.nhle.com/