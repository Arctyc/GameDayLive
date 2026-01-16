// Update intervals (in milliseconds)
export const UPDATE_INTERVALS = {
  LIVE_GAME_DEFAULT: 30 * 1000, // Seconds to wait between updates, normal
  OVERTIME_SHOOTOUT: 15 * 1000, // Seconds to wait between updates, OT/SO
  INTERMISSION: 60 * 1000, // Seconds before next period to resume updating during intermission
  PREGAME_THREAD_OFFSET: 60 * 60 * 1000,  // 1 hour before game
  LATE_SCHEDULE_THRESHOLD: 3 * 60 * 60 * 1000 // 3 hours after start
} as const;

// Redis key prefixes
export const REDIS_KEYS = {
  GAME_ETAG: (gameId: number) => `game:${gameId}:etag`,
  GAME_STATE: (gameId: number) => `game:${gameId}:state`, // Unused
  GAME_THREAD_ID: (gameId: number) => `game:${gameId}:threadId`,
  POSTGAME_THREAD_ID: (gameId: number) => `game:${gameId}:postgameThreadId`,
  SCHEDULED_JOB_ID: (gameId: number) => `game:${gameId}:scheduledJob`,
  
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