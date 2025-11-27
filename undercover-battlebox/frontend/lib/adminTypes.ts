/* ============================================================================
   adminTypes.ts — BattleBox v15 (patched for realtime diamonds)
   ✔ Gesynchroniseerd met server.ts v7 & game-engine v15
   ✔ Round-based scoring compatible
   ✔ Correcte arena structuur
   ✔ Realtime arena diamonds (NEW)
   ✔ Realtime host diamonds (NEW)
============================================================================ */

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

  /** 
   * v15 legacy field (UI static scoring)
   * blijft bestaan zodat frontend niet breekt
   */
  score: number;

  /**
   * ✔ NIEUW — Realtime diamonds field
   * Wordt live geüpdatet door 3-gift-engine.ts v15.2
   */
  diamonds: number;

  boosters: string[];

  /**
   * legacy, niet gebruikt voor sorting — positionStatus bepaalt dit
   */
  status: "alive" | "eliminated";

  positionStatus: ArenaPlayerStatus;

  is_vip?: boolean;
  is_fan?: boolean;

  vip_expires_at?: string | null;
  fan_expires_at?: string | null;
}

/* ================================
   ARENA STATE (FULL v15)
================================ */
export interface ArenaState {
  players: ArenaPlayer[];

  round: number;
  type: "quarter" | "finale";

  status: "idle" | "active" | "grace" | "ended";

  /** UI convenience */
  timeLeft: number;

  /** shortcut: status === "active" */
  isRunning: boolean;

  /** timestamps */
  roundStartTime: number;
  roundCutoff: number;
  graceEnd: number;

  /** settings */
  settings: {
    roundDurationPre: number;
    roundDurationFinal: number;
    graceSeconds: number;
    forceEliminations: boolean;
  };

  /** baseline indicator */
  firstFinalRound: number | null;

  /** UI internal sorting timestamp */
  lastSortedAt: number;

  /**
   * ✔ NIEUW — realtime host diamonds
   * Updatet live via gift-engine
   */
  host_diamonds?: number;
}

/* ================================
   QUEUE ENTRY
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
   SEARCH USER RESULT
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
   HOST PROFILE
================================ */
export interface HostProfile {
  id: number;
  username: string;
  tiktok_id: string;
  active: boolean;
}

/* ================================
   ARENA SETTINGS
================================ */
export interface ArenaSettings {
  roundDurationPre: number;
  roundDurationFinal: number;
  graceSeconds: number;
  forceEliminations: boolean;
}

/* ================================
   LEADERBOARDS — GIFTS DRIVEN
================================ */
export interface PlayerLeaderboardEntry {
  tiktok_id: string;
  username: string;
  display_name: string;
  total_score: number;
}

export interface GifterLeaderboardEntry {
  user_id: string;
  username: string;
  display_name: string;
  total_diamonds: number;
}

/* ================================
   INITIAL SNAPSHOT
================================ */
export interface InitialSnapshot {
  arena: ArenaState;

  queue: {
    open: boolean;
    entries: QueueEntry[];
  };

  logs: LogEntry[];
  settings: ArenaSettings;

  gameSession: {
    active: boolean;
    gameId: number | null;
  };

  stats:
    | {
        totalPlayers: number;
        totalPlayerDiamonds: number;
        totalHostDiamonds: number;
      }
    | null;

  playerLeaderboard: PlayerLeaderboardEntry[];
  gifterLeaderboard: GifterLeaderboardEntry[];
}

/* ================================
   SOCKET INBOUND
================================ */
export interface AdminSocketInbound {
  updateArena: (arena: ArenaState) => void;

  updateQueue: (q: { open: boolean; entries: QueueEntry[] }) => void;

  log: (log: LogEntry) => void;
  initialLogs: (logs: LogEntry[]) => void;

  streamStats: (stats: {
    totalPlayers: number;
    totalPlayerDiamonds: number;
    totalHostDiamonds: number;
  }) => void;

  leaderboardPlayers: (rows: PlayerLeaderboardEntry[]) => void;
  leaderboardGifters: (rows: GifterLeaderboardEntry[]) => void;

  connectState: (state: any) => void;
  gameSession: (session: any) => void;

  hostDiamonds: (data: { username: string; total: number }) => void;

  settings: (settings: ArenaSettings) => void;

  hosts: (rows: HostProfile[]) => void;

  hostsActiveChanged: (payload: { username: string; tiktok_id: string }) => void;

  "round:start": (payload: {
    round: number;
    type: "quarter" | "finale";
    duration: number;
  }) => void;

  "round:grace": (payload: { round: number; grace: number }) => void;

  "round:end": (payload: {
    round: number;
    type: "quarter" | "finale";
    pendingEliminations: string[];
    top3: {
      id: string;
      display_name: string;
      username: string;
      diamonds: number;
    }[];
  }) => void;
}

/* ================================
   SOCKET OUTBOUND
================================ */
export interface AdminSocketOutbound {
  ping: () => void;

  getInitialSnapshot: (payload: {}, ack: (snap: InitialSnapshot) => void) => void;

  getHosts: (
    payload: {},
    ack: (res: { success: boolean; hosts: HostProfile[] }) => void
  ) => void;

  createHost: (
    payload: { label: string; username: string; tiktok_id: string },
    ack: (res: AdminAckResponse) => void
  ) => void;

  deleteHost: (
    payload: { id: number },
    ack: (res: AdminAckResponse) => void
  ) => void;

  setActiveHost: (
    payload: { id: number },
    ack: (res: AdminAckResponse) => void
  ) => void;

  searchUsers: (
    payload: { query: string },
    ack: (res: { users: SearchUser[] }) => void
  ) => void;

  addToQueue: (
    payload: { username: string },
    ack: (res: AdminAckResponse) => void
  ) => void;

  removeFromQueue: (
    payload: { username: string },
    ack: (res: AdminAckResponse) => void
  ) => void;

  addToArena: (
    payload: { username: string },
    ack: (res: AdminAckResponse) => void
  ) => void;

  eliminate: (
    payload: { username: string },
    ack: (res: AdminAckResponse) => void
  ) => void;

  startGame: (payload: {}, ack: (res: AdminAckResponse) => void) => void;
  stopGame: (payload: {}, ack: (res: AdminAckResponse) => void) => void;

  startRound: (
    payload: { type: "quarter" | "finale" },
    ack: (res: AdminAckResponse) => void
  ) => void;

  endRound: (payload: {}, ack: (res: AdminAckResponse) => void) => void;

  giveTwist: (
    payload: { username: string; twist: string },
    ack: (res: AdminAckResponse) => void
  ) => void;

  useTwist: (
    payload: { username: string; twist: string; target?: string },
    ack: (res: AdminAckResponse) => void
  ) => void;

  updateRoundSettings: (
    payload: {
      pre: number;
      final: number;
      grace: number;
    },
    ack: (res: AdminAckResponse) => void
  ) => void;
}
