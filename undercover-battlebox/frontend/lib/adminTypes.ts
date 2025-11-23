// lib/adminTypes.ts

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
  status: "alive" | "eliminated";

  // UI kleurstatus
  positionStatus: ArenaPlayerStatus;

  // Premium flags (handig voor finale UI, toekomstige buffs)
  is_vip?: boolean;
  is_fan?: boolean;
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
   QUEUE ENTRIES (INCL. VIP/FAN)
================================ */

export type QueueEntry = {
  position: number;
  tiktok_id: string;
  display_name: string;
  username: string;

  // boosters / VIP priority
  priorityDelta: number;

  // teller waarom iemand staat waar 'ie staat
  reason: string;

  // Premium states
  is_vip: boolean;
  is_fan: boolean;

  // Nieuwe velden
  vip_expires_at?: string | null;
  fan_expires_at?: string | null;
};

/* ================================
   GLOBAL TOGGLES
================================ */

export type GlobalToggles = {
  queueOpen: boolean;
  boostersEnabled: boolean;
  twistsEnabled: boolean;
  roundType: "voorronde" | "finale";
  debugLogs: boolean;
  dayResetTime: string;
};

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
   SOCKET ADMIN ACK
================================ */

export interface AdminAckResponse {
  success: boolean;
  message?: string;
}

/* ================================
   AUTOCOMPLETE USER (admin:searchUsers)
================================ */

export interface SearchUser {
  tiktok_id: string;
  username: string;
  display_name: string;

  // Premium info zichtbaar in dropdown
  is_vip?: boolean;
  vip_expires_at?: string | null;

  is_fan?: boolean;
  fan_expires_at?: string | null;

  // handig voor sortering
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
