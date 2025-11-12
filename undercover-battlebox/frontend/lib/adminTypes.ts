// lib/adminTypes.ts

export type ArenaPlayerStatus = "alive" | "eliminated" | "shielded" | "danger";

export interface ArenaPlayer {
  id: string;
  display_name: string;
  username: string;
  diamonds: number;
  boosters: string[];
  status: "alive" | "eliminated";
}

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
  };
  lastSortedAt: number;
}

export type QueueEntry = {
  position: number;
  tiktok_id: string;
  display_name: string;
  username: string;
  priorityDelta: number; // bv. +2 als gevolg van boosters
  reason: string; // "VIP", "Booster", "Fan", etc.
  is_vip: boolean;
  is_fan: boolean;
};

export type GlobalToggles = {
  queueOpen: boolean;
  boostersEnabled: boolean;
  twistsEnabled: boolean;
  roundType: "voorronde" | "finale";
  debugLogs: boolean;
  dayResetTime: string; // "03:00"
};

// Nieuw: logstructuur voor live feed
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
  | "system";

export interface LogEntry {
  id: string;
  timestamp: string; // ISO string
  type: LogType;
  message: string;
  meta?: Record<string, unknown>;
}

// Socket acknowledgements
export interface AdminAckResponse {
  success: boolean;
  message?: string;
}
