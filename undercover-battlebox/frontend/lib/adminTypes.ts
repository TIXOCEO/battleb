/* ================================
   ARENA PLAYER TYPES
================================ */
export type ArenaPlayerStatus =
  | "alive"
  | "eliminated"
  | "shielded"
  | "danger"
  | "elimination"
  | "immune";

export interface ArenaPlayer {
  id: string;
  display_name: string;
  username: string;

  diamonds: number;
  boosters: string[];

  /** Server primary state */
  status: "alive" | "eliminated";

  /** UI state (sorting outcome / danger zone / immunity) */
  positionStatus: ArenaPlayerStatus;

  is_vip?: boolean;
  is_fan?: boolean;

  vip_expires_at?: string | null;
  fan_expires_at?: string | null;
}

/* ================================
   ARENA STATE
================================ */
export interface ArenaState {
  players: ArenaPlayer[];

  round: number;
  type: "quarter" | "semi" | "finale";

  status: "idle" | "active" | "grace" | "ended";
  timeLeft: number;
  isRunning: boolean;

  roundStartTime: number;
  roundCutoff: number;
  graceEnd: number;

  settings: {
    roundDurationPre: number;
    roundDurationFinal: number;
    graceSeconds: number;
    forceEliminations: boolean;
  };

  lastSortedAt: number;
}

/* ================================
   QUEUE ENTRIES
================================ */
export interface QueueEntry {
  position: number;

  tiktok_id: string;
  display_name: string;
  username: string;

  priorityDelta: number;
  reason: string;

  is_vip: boolean;
  is_fan: boolean;

  vip_expires_at?: string | null;
  fan_expires_at?: string | null;
}

/* ================================
   GLOBAL TOGGLES
================================ */
export interface GlobalToggles {
  queueOpen: boolean;
  boostersEnabled: boolean;
  twistsEnabled: boolean;
  roundType: "voorronde" | "finale";
  debugLogs: boolean;

  /** Server daily reset moment HH:MM */
  dayResetTime: string;
}

/* ================================
   LOG FEED
================================ */
export type LogType =
  | "gift"
  | "join"
  | "elim"
  | "booster"
  | "twist"
  | "reset"
  | "error"
  | "queue"
  | "arena"
  | "system"
  | "vip"
  | "fan";

export interface LogEntry {
  id: string;
  timestamp: string;
  type: LogType;
  message: string;
  meta?: Record<string, unknown>;
}

/* ================================
   ACK RESPONSE
================================ */
export interface AdminAckResponse {
  success: boolean;
  message?: string;
}

/* ================================
   AUTOCOMPLETE RESULTS
================================ */
export interface SearchUser {
  tiktok_id: string;
  username: string;
  display_name: string;

  is_vip?: boolean;
  vip_expires_at?: string | null;

  is_fan?: boolean;
  fan_expires_at?: string | null;

  last_seen_at?: string | null;
}

/* ================================
   LEADERBOARDS
================================ */
export interface PlayerLeaderboardEntry {
  username: string;
  display_name: string;
  tiktok_id: string;

  diamonds_total: number;

  is_vip?: boolean;
  is_fan?: boolean;
}

export interface GifterLeaderboardEntry {
  user_id: string;
  username: string;
  display_name: string;
  total_diamonds: number;
}
