/* ============================================================================
   adminTypes.ts — BattleBox v12.2
   Volledig in sync met backend (server.ts)
   Geen ontbrekende outbound events meer
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

  diamonds: number;
  boosters: string[];

  status: "alive" | "eliminated";
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
   SEARCH RESULTS
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
   HOST PROFILES
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
   LEADERBOARDS
================================ */
export interface PlayerLeaderboardEntry {
  username: string;
  display_name: string;
  tiktok_id: string;

  total_diamonds?: number;
  diamonds_total?: number;

  is_vip?: boolean;
  is_fan?: boolean;
}

export interface GifterLeaderboardEntry {
  user_id: string;
  username: string;
  display_name: string;
  total_diamonds: number;
}

/* ============================================================================
   INITIAL SNAPSHOT
============================================================================ */
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

  stats: {
    total_players?: number;
    total_player_diamonds?: number;
    total_host_diamonds?: number;
  } | null;

  playerLeaderboard: PlayerLeaderboardEntry[];
  gifterLeaderboard: GifterLeaderboardEntry[];
}

/* ============================================================================
   SOCKET OUTBOUND TYPES (admin → server)
   Exact 1:1 met server.ts (socket.onAny → handle(action))
============================================================================ */
export interface AdminSocketOutbound {
  /* SNAPSHOT + SETTINGS + HOSTS */
  "admin:getInitialSnapshot": (
    payload: {},
    ack: (snap: InitialSnapshot) => void
  ) => void;

  "admin:getHosts": (
    payload: {},
    ack: (res: { success: boolean; hosts: HostProfile[] }) => void
  ) => void;

  "admin:createHost": (
    payload: { label: string; username: string; tiktok_id: string },
    ack: (res: AdminAckResponse) => void
  ) => void;

  "admin:deleteHost": (
    payload: { id: number },
    ack: (res: AdminAckResponse) => void
  ) => void;

  "admin:setActiveHost": (
    payload: { id: number },
    ack: (res: AdminAckResponse) => void
  ) => void;

  "admin:getSettings": (
    payload: {},
    ack: (res: { success: boolean; settings: ArenaSettings; gameActive: boolean }) => void
  ) => void;

  "admin:updateSettings": (
    payload: ArenaSettings,
    ack: (res: AdminAckResponse) => void
  ) => void;

  /* SEARCH */
  "admin:searchUsers": (
    payload: { query: string },
    ack: (res: { users: SearchUser[] }) => void
  ) => void;

  /* QUEUE */
  "admin:addToQueue": (
    payload: { username: string },
    ack: (res: AdminAckResponse) => void
  ) => void;

  "admin:removeFromQueue": (
    payload: { username: string },
    ack: (res: AdminAckResponse) => void
  ) => void;

  "admin:promoteUser": (
    payload: { username: string },
    ack: (res: AdminAckResponse) => void
  ) => void;

  "admin:demoteUser": (
    payload: { username: string },
    ack: (res: AdminAckResponse) => void
  ) => void;

  /* ARENA */
  "admin:addToArena": (
    payload: { username: string },
    ack: (res: AdminAckResponse) => void
  ) => void;

  "admin:eliminate": (
    payload: { username: string },
    ack: (res: AdminAckResponse) => void
  ) => void;

  /* GAME FLOW */
  "admin:startGame": (payload: {}, ack: (res: AdminAckResponse) => void) => void;
  "admin:stopGame": (payload: {}, ack: (res: AdminAckResponse) => void) => void;

  "admin:startRound": (
    payload: { type: "quarter" | "finale" },
    ack: (res: AdminAckResponse) => void
  ) => void;

  "admin:endRound": (
    payload: {},
    ack: (res: AdminAckResponse) => void
  ) => void;

  /* TWISTS */
  "admin:giveTwist": (
    payload: { username: string; twist: string },
    ack: (res: AdminAckResponse) => void
  ) => void;

  "admin:useTwist": (
    payload: { username: string; twist: string; target?: string },
    ack: (res: AdminAckResponse) => void
  ) => void;

  /* MISC */
  ping: () => void;
}
