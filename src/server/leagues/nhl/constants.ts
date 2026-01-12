// Update intervals (in milliseconds)
export const UPDATE_INTERVALS = {
  LIVE_GAME_DEFAULT: 30 * 1000,           // 30 seconds
  OVERTIME_SHOOTOUT: 15 * 1000,           // 15 seconds
  INTERMISSION: 60 * 1000,                // 60 seconds before next period
  PREGAME_THREAD_OFFSET: 60 * 60 * 1000,  // 1 hour before game
} as const;

// Redis key prefixes
export const REDIS_KEYS = {
  GAME_ETAG: (gameId: number) => `game:${gameId}:etag`,
  GAME_STATE: (gameId: number) => `game:${gameId}:state`,
} as const;

// Game states
export const GAME_STATES = {
  FUT: 'FUT',
  PRE: 'PRE',
  LIVE: 'LIVE',
  CRIT: 'CRIT',
  FINAL: 'FINAL',
  OFF: 'OFF',
  PREVIEW: 'PREVIEW',
  UNKNOWN: 'UNKNOWN',
} as const;