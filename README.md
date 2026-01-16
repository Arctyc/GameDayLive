# GameDayLive

Automated game day and post-game thread app for sports subreddits.

## Contact & Support

- [Discord](https://discord.gg/JjNUv3nsSc) <- Preferred method
- [Reddit](https://www.reddit.com/message/compose/?to=ArctycDev)
- [Github](https://github.com/Arctyc/GameDayLive)

## Overview

GameDayLive automatically creates and updates live game threads for NHL teams (with support for more sports possible).

The app:
- Posts game day threads 1 hour before puck drop
- Updates threads live with game details, goals, penalties, and scores every ~30 seconds
- Creates post-game threads when games end (optional)
- Note: data is obtained by public APIs and is provided with no affiliation to any organization.

## Features

- **NHL Support**: Integration with the NHL API for real-time game data
- **Modular Design**: Easily extensible for MLB, NFL, NBA, or any other sport/league
- **Per-Subreddit Configuration**: Each subreddit selects their league, team, and preferences

## Installation

Note: installation and configuration is not compatible with old reddit, but the app is!

Moderators can install GameDayLive from the Reddit Apps directory:

1. From your subreddit, click Mod Tools
2. select Browse Apps on the left sidebar
3. Search for and select "GameDayLive" and "+ Add to community"

## Configuration

1. Click the subreddit menu (three dots next to Mod Tools)
2. Select "Configure GameDayLive"
3. Choose your team and preferences

That's it! 
The app will now automatically create game day and (optionally) post-game threads for your chosen team.

## Maintenance

- A scheduled job menu is available to view and cancel any scheduled action (i.e. A future game thread post or live update)
- If necessary, uninstalling and reinstalling the app will clear your settings and scheduled jobs.

## Development - WARNING: Nerd stuff below this point!

### Prerequisites

- Node.js 18+
- TypeScript 5+
- Devvit (More info: https://developers.reddit.com/)

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
devvit playtest r/your_test_subreddit
```

### Project Structure
```
src/
└── server
    ├── actions
    │   ├── configMenu.ts
    │   └── scheduleMenu.ts
    ├── leagues
    │   ├── nhl
    │   │   ├── api.ts
    │   │   ├── config.ts
    │   │   ├── constants.ts
    │   │   ├── formatter.ts
    │   │   ├── jobs.ts
    │   │   ├── scheduler.ts
    │   │   └── types.ts
    │   └── index.ts
    ├── utils
    │   └── Logger.ts
    ├── config.ts
    ├── index.ts
    ├── threads.ts
    └── types.ts
```

### Adding a New League

1. Create `src/server/leagues/{league}/` directory
    - `api.ts`          - API client for your data
    - `config.ts`       - Team configs (timezones, common names, etc.)
    - `constants.ts`    - League-specific constants
    - `formatter.ts`    - Reddit thread formatting
    - `jobs.ts`         - Core job logic (daily check, thread creation, updates)
    - `scheduler.ts`    - Scheduler route handlers
    - `types.ts`        - League-specific permanent data

2. Update `src/server/types.ts`, `src/server/actions/configMenu.ts`, `src/server/leagues/index.ts`

4. Register scheduler in `src/server/index.ts` Note: Schedule execution and league-specific jobs need to be decoupled, (e.g.):
    - Current   `/internal/scheduler/daily-game-check -> nhl/jobs.ts`
    - Fix:      `/internal/scheduler/daily-game-check -> leagues/index.ts -> {league}/jobs.ts`

## Roadmap

- [x] NHL support
- [ ] More customization (e.g. pre-game post time, optional sticky, optional lock thread after game)
- [ ] More sports/leagues
- [ ] Your desired features? Contribute or request!

## Contributing

Contributions welcome! Please open an issue or submit a pull request.

## License

GPL-3.0

## Credits

Built with [Devvit](https://developers.reddit.com/docs) - Reddit's Developer Platform

Game data provided by:
- NHL: https://api-web.nhle.com/