// Update intervals (in milliseconds)
export const UPDATE_INTERVALS = {
  LIVE_GAME_DEFAULT: 30 * 1000, // Seconds to wait between updates, normal
  OVERTIME_SHOOTOUT: 15 * 1000, // Seconds to wait between updates, OT/SO
  INTERMISSION: 60 * 1000, // Seconds before next period to resume updating during intermission
  PREGAME_THREAD_OFFSET: 60 * 60 * 1000,  // 1 hour before game
  PREGAME_UPDATE_INTERVAL: 10 * 60 * 1000, // 10 minutes between right-rail updates
  LATE_SCHEDULE_THRESHOLD: 3 * 60 * 60 * 1000, // 3 hours after start
  PGT_CLEANUP_DELAY: 18 * 60 * 60 * 1000, // Clean up PGT after 18 hours // TODO: Allow custom timing
  RETRY_MAX_TIME: 1800000,
} as const;

// Redis key prefixes
export const REDIS_KEYS = {
  DAILY_CHECK_ATTEMPTS: () => `daily:check:attempts`,
  CREATE_THREAD_ATTEMPTS: (gameId: number) => `game:${gameId}:thread:create:attempts`,
  CREATE_PGT_ATTEMPTS: (gameId: number) => `game:${gameId}:pgt:create:attemtps`,
  GAME_ETAG: (gameId: number) => `game:${gameId}:etag`,
  GAME_STATE: (gameId: number) => `game:${gameId}:state`,
  GAME_START_TIME: (gameId: number) => `game:${gameId}:startTime`,
  GAME_TO_THREAD_ID: (gameId: number) => `game:${gameId}:threadId`,
  THREAD_TO_GAME_ID: (postId: string) => `threadId:${postId}:gameId`,
  GAME_TO_PGT_ID: (gameId: number) => `game:${gameId}:postgameThreadId`,
  PGT_TO_GAME_ID: (postId: string) => `postgameThreadId:${postId}:gameId`,
  JOB_DAILY_CHECK: () => `job:dailyCheck`,
  JOB_CREATE: (gameId: number) => `job:create:${gameId}`,
  JOB_GDT_UPDATE: (gameId: number) => `job:gdt:update:${gameId}`,
  JOB_PGT_MONITOR: (gameId: number) => `job:pgt:monitor:${gameId}`,
  JOB_PREGAME: (gameId: number) => `job:pregame:${gameId}`,
  JOB_PREGAME_CLEANUP: (gameId: number) => `job:pregame:cleanup:${gameId}`,
  JOB_POSTGAME: (gameId: number) => `job:pgt:${gameId}`,
  JOB_PGT_UPDATE: (gameId: number) => `job:pgt:update:${gameId}`,
  JOB_PGT_CLEANUP: (gameId: number) => `job:pgt:cleanup:${gameId}`,
  GAME_TO_PREGAME_ID: (gameId: number) => `game:${gameId}:pregameThreadId`,
  PREGAME_TO_GAME_ID: (postId: string) => `pregameThreadId:${postId}:gameId`,
  PREGAME_ETAG: (gameId: number) => `game:${gameId}:pregame:etag`,
  JOB_PREGAME_UPDATE: (gameId: number) => `job:pregame:update:${gameId}`,
  GDT_OFFICIALS: (gameId: number) => `game:${gameId}:gdt:officials`,
  GDT_RIGHTRAIL_ETAG: (gameId: number) => `game:${gameId}:gdt:rightrail:etag`,
  PGT_THREE_STARS: (gameId: number) => `game:${gameId}:pgt:threestars`,
  EXPIRY: 86400, // 24 hours
} as const;

export const JOB_NAMES = {
  DAILY_GAME_CHECK: `daily-game-check-retry`,
  CREATE_PREGAME_THREAD: `create-pregame-thread`,
  PREGAME_CLEANUP: `pregame-cleanup`,
  NEXT_PREGAME_UPDATE: `next-pregame-update`,
  CREATE_GAME_THREAD: `create-game-thread`,
  CREATE_POSTGAME_THREAD: `create-postgame-thread`,
  NEXT_LIVE_UPDATE: `next-live-update`,
  NEXT_PGT_MONITOR: `next-pgt-monitor`,
  NEXT_PGT_UPDATE: `next-pgt-update`,
  PGT_CLEANUP: `pgt-cleanup`,
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

// Standardized comments
export const COMMENTS = {
  CLOSED_GDT_BASE: `This thread has been closed, you can continue the discussion in the post-game thread at: `,
}