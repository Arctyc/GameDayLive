// Update intervals (in milliseconds)
export const UPDATE_INTERVALS = {
  LIVE_GAME_DEFAULT: 30 * 1000, // Seconds to wait between updates, normal
  OVERTIME_SHOOTOUT: 15 * 1000, // Seconds to wait between updates, OT/SO
  INTERMISSION: 60 * 1000, // Seconds before next period to resume updating during intermission
  PREGAME_THREAD_OFFSET: 60 * 60 * 1000,  // 1 hour before game
  LATE_SCHEDULE_THRESHOLD: 3 * 60 * 60 * 1000, // 3 hours after start
} as const;

// Redis key prefixes
export const REDIS_KEYS = {
  GAME_ETAG: (gameId: number) => `game:${gameId}:etag`,
  GAME_STATE: (gameId: number) => `game:${gameId}:state`, // Unused
  GAME_TO_THREAD_ID: (gameId: number) => `game:${gameId}:threadId`,
  THREAD_TO_GAME_ID: (postId: string) => `threadId:${postId}:gameId`,
  GAME_TO_PGT_ID: (gameId: number) => `game:${gameId}:postgameThreadId`,
  PGT_TO_GAME_ID: (postId: string) => `postgameThreadId:${postId}:gameId`,
  JOB_CREATE: (gameId: number) => `job:create:${gameId}`,
  JOB_GDT_UPDATE: (gameId: number) => `job:gdt:update:${gameId}`,
  JOB_POSTGAME: (gameId: number) => `job:pgt:${gameId}`,
  JOB_PGT_UPDATE: (gameId: number) => `job:pgt:update:${gameId}`,
  EXPIRY: 86400, // 24 hours
} as const;

export const JOB_NAMES = {
  CREATE_GAME_THREAD: `create-game-thread`,
  CREATE_POSTGAME_THREAD: `create-postgame-thread`,
  NEXT_LIVE_UPDATE: `next-live-update`,
  NEXT_PGT_UPDATE: `next-pgt-update`,
}

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