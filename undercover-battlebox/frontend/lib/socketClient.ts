// ============================================================================
// frontend/lib/socketClient.ts — v12 BattleBox Upgrade
// ----------------------------------------------------------------------------
// ✔ Nieuwe snapshot payload ondersteund
// ✔ Nieuwe leaderboard events (leaderboardPlayers / leaderboardGifters)
// ✔ Types uitgebreid
// ✔ connect() handler laadt ALLE nieuwe data
// ✔ Geen logica verwijderd
// ============================================================================

import { io, Socket } from "socket.io-client";
import type {
  ArenaState,
  QueueEntry,
  LogEntry,
  AdminAckResponse,
  PlayerLeaderboardEntry,
  GifterLeaderboardEntry,
  SearchUser,
  HostProfile,
  ArenaSettings,
  InitialSnapshot,           // ★ toegevoegd
} from "./adminTypes";

const BACKEND_URL = "http://178.251.232.12:4000";

const ADMIN_TOKEN =
  process.env.NEXT_PUBLIC_ADMIN_TOKEN || "supergeheim123";

declare global {
  var __adminSocket: Socket | undefined;
}

/* ===========================================
   INBOUND EVENTS (SERVER → CLIENT)
=========================================== */
export interface AdminSocketInbound {
  connect: () => void;
  disconnect: (reason: string) => void;
  connect_error: (err: Error) => void;

  updateArena: (data: ArenaState) => void;
  updateQueue: (data: { open: boolean; entries: QueueEntry[] }) => void;

  leaderboardPlayers: (rows: PlayerLeaderboardEntry[]) => void;
  leaderboardGifters: (rows: GifterLeaderboardEntry[]) => void;

  log: (row: LogEntry) => void;
  initialLogs: (rows: LogEntry[]) => void;

  streamStats: (stats: {
    totalPlayers: number;
    totalPlayerDiamonds: number;
    totalHostDiamonds: number;
  }) => void;

  gameSession: (state: {
    active: boolean;
    gameId: number | null;
    startedAt?: string | null;
    endedAt?: string | null;
  }) => void;

  "round:start": (d: any) => void;
  "round:grace": (d: any) => void;
  "round:end": () => void;

  // HOST SYSTEM
  hosts: (rows: HostProfile[]) => void;
  hostsActiveChanged: (payload: {
    username: string;
    tiktok_id: string;
  }) => void;

  // SETTINGS
  settings: (s: ArenaSettings) => void;

  // CONNECTION STATE / SNAPSHOT
  connectState: (payload: {
    connected: boolean;
    host?: {
      username: string;
      id: string;
    };
  }) => void;

  snapshot: (snap: InitialSnapshot) => void;  // ★ toegevoegd

  pong: () => void;
}

/* ===========================================
   OUTBOUND EVENTS (CLIENT → SERVER)
=========================================== */
export interface AdminSocketOutbound {
  "admin:getInitialSnapshot": (
    payload?: {},
    cb?: (snap: InitialSnapshot) => void   // ★ gespecificeerd
  ) => void;

  "admin:getHosts": (
    payload?: {},
    cb?: (res: { success: boolean; hosts: HostProfile[] }) => void
  ) => void;

  "admin:createHost": (
    payload: { label: string; username: string; tiktok_id: string },
    cb?: (res: AdminAckResponse) => void
  ) => void;

  "admin:deleteHost": (
    payload: { id: number },
    cb?: (res: AdminAckResponse) => void
  ) => void;

  "admin:setActiveHost": (
    payload: { id: number },
    cb?: (res: AdminAckResponse) => void
  ) => void;

  "admin:addToArena": (
    payload: { username: string },
    cb?: (res: AdminAckResponse) => void
  ) => void;

  "admin:addToQueue": (
    payload: { username: string },
    cb?: (res: AdminAckResponse) => void
  ) => void;

  "admin:removeFromQueue": (
    payload: { username: string },
    cb?: (res: AdminAckResponse) => void
  ) => void;

  "admin:promoteUser": (
    payload: { username: string },
    cb?: (res: AdminAckResponse) => void
  ) => void;

  "admin:demoteUser": (
    payload: { username: string },
    cb?: (res: AdminAckResponse) => void
  ) => void;

  "admin:eliminate": (
    payload: { username: string },
    cb?: (res: AdminAckResponse) => void
  ) => void;

  // PREMIUM
  "admin:giveVip": (p: { username: string }, cb?: (res: AdminAckResponse) => void) => void;
  "admin:removeVip": (p: { username: string }, cb?: (res: AdminAckResponse) => void) => void;
  "admin:giveFan": (p: { username: string }, cb?: (res: AdminAckResponse) => void) => void;

  // TWISTS
  "admin:giveTwist": (
    p: { username: string; twist: string },
    cb?: (res: AdminAckResponse) => void
  ) => void;

  "admin:useTwist": (
    p: { username: string; twist: string; target?: string },
    cb?: (res: AdminAckResponse) => void
  ) => void;

  // ENGINE
  "admin:startRound": (p: { type: "quarter" | "finale" }, cb?: (r: AdminAckResponse) => void) => void;
  "admin:endRound": (p?: {}, cb?: (r: AdminAckResponse) => void) => void;
  "admin:startGame": (p?: {}, cb?: (r: AdminAckResponse) => void) => void;
  "admin:stopGame": (p?: {}, cb?: (r: AdminAckResponse) => void) => void;

  // SETTINGS
  "admin:getSettings": (
    payload?: {},
    cb?: (res: { success: boolean; settings: ArenaSettings; gameActive: boolean }) => void
  ) => void;

  "admin:updateSettings": (
    payload: ArenaSettings,
    cb?: (res: AdminAckResponse) => void
  ) => void;

  // SEARCH
  "admin:searchUsers": (payload: { query: string }, cb: (res: { users: SearchUser[] }) => void) => void;

  ping: () => void;
}

/* ===========================================
   SINGLETON SOCKET
=========================================== */
export function getAdminSocket(): Socket<
  AdminSocketInbound,
  AdminSocketOutbound
> {
  if (typeof window === "undefined") {
    throw new Error("getAdminSocket moet client-side gebruikt worden.");
  }

  if (globalThis.__adminSocket) {
    return globalThis.__adminSocket as any;
  }

  console.log(`⚙️ Verbinden met backend socket: ${BACKEND_URL}`);

  const socket: Socket<
    AdminSocketInbound,
    AdminSocketOutbound
  > = io(BACKEND_URL, {
    transports: ["polling", "websocket"],
    path: "/socket.io",
    auth: { token: ADMIN_TOKEN, role: "admin" },
    reconnection: true,
    reconnectionAttempts: 60,
    reconnectionDelay: 1500,
    timeout: 9000,
  });

  /* AUTO-RESYNC NA CONNECT */
  socket.on("connect", () => {
    console.log("✅ Admin socket verbonden:", socket.id);

    socket.emit("ping");

    // ★ Vraag volledige snapshot op
    socket.emit("admin:getInitialSnapshot", {}, (snap) => {
      if (snap) {
        // server pusht 'snapshot' event, maar callback vangt het ook op
        socket.emit("snapshot", snap);
      }
    });

    // ★ Haal hosts op
    socket.emit("admin:getHosts", {}, () => {});

    // ★ Haal settings op
    socket.emit("admin:getSettings", {}, () => {});
  });

  socket.on("disconnect", (reason) => {
    console.warn("⚠️ Admin socket disconnect:", reason);
  });

  socket.on("connect_error", (err) => {
    console.error("❌ Connect error:", err?.message || err);
  });

  /* Heartbeat */
  setInterval(() => {
    try {
      socket.emit("ping");
    } catch (_) {}
  }, 12000);

  globalThis.__adminSocket = socket;
  return socket;
}

export default getAdminSocket;
