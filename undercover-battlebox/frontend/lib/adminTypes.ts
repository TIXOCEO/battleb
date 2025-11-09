// lib/adminTypes.ts

export type ArenaPlayerStatus = "alive" | "eliminated";

export type ArenaPlayer = {
  id: string;            // tiktok_id als string
  display_name: string;
  username: string;
  diamonds: number;      // huidige ronde
  boosters: string[];
  status: ArenaPlayerStatus;
};

export type ArenaState = {
  round: number;
  type: "quarter" | "semi" | "finale";
  timeLeft: number;      // seconden
  players: ArenaPlayer[];
};

export type QueueEntry = {
  position: number;
  tiktok_id: string;
  display_name: string;
  username: string;
  priorityDelta: number; // bv. +2 als gevolg van boosters
  reason: string;        // "VIP", "Booster", "Fan", etc.
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
