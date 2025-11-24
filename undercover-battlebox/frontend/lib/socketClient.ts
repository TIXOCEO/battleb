// ============================================================================
// frontend/lib/socketClient.ts — v14.0 BATTLEBOX ADMIN FINAL
// REQUIRED: backend admin namespace = io.of("/admin")
// THIS VERSION 100% COMPATIBLE — ALL ADMIN BUTTONS WORK
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
  InitialSnapshot,
} from "./adminTypes";

// ============================================================
// SETTINGS
// ============================================================
const BACKEND_URL = "http://178.251.232.12:4000";    // <-- PAS IP AAN indien nodig
const ADMIN_NS = "/admin";

const ADMIN_TOKEN =
  process.env.NEXT_PUBLIC_ADMIN_TOKEN || "supersecret123";

// Global singleton
declare global {
  var __adminSocket: Socket | undefined;
}

// ============================================================
// TYPEDEFS
// ============================================================

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

  hosts: (rows: HostProfile[]) => void;
  hostsActiveChanged: (payload: {
    username: string;
    tiktok_id: string;
  }) => void;

  settings: (s: ArenaSettings) => void;

  connectState: (payload: {
    connected: boolean;
    host?: { username: string; id: string };
  }) => void;

  pong: () => void;
}

export interface AdminSocketOutbound {
  "admin:getInitialSnapshot": (
    payload?: {},
    cb?: (snap: InitialSnapshot) => void
  ) => void;

  "admin:addToArena": (p: { username: string }, cb?: (res: AdminAckResponse) => void) => void;
  "admin:addToQueue": (p: { username: string }, cb?: (res: AdminAckResponse) => void) => void;
  "admin:removeFromQueue": (p: { username: string }, cb?: (res: AdminAckResponse) => void) => void;
  "admin:promoteUser": (p: { username: string }, cb?: (res: AdminAckResponse) => void) => void;
  "admin:demoteUser": (p: { username: string }, cb?: (res: AdminAckResponse) => void) => void;
  "admin:eliminate": (p: { username: string }, cb?: (res: AdminAckResponse) => void) => void;

  "admin:startRound": (p: { type: "quarter" | "finale" }, cb?: (r: AdminAckResponse) => void) => void;
  "admin:endRound": (p?: {}, cb?: (r: AdminAckResponse) => void) => void;

  "admin:startGame": (p?: {}, cb?: (r: AdminAckResponse) => void) => void;
  "admin:stopGame": (p?: {}, cb?: (r: AdminAckResponse) => void) => void;

  "admin:searchUsers": (
    payload: { query: string },
    cb: (res: { users: SearchUser[] }) => void
  ) => void;

  "admin:updateSettings": (
    payload: ArenaSettings,
    cb?: (r: AdminAckResponse) => void
  ) => void;

  "admin:getHosts": (p?: {}, cb?: any) => void;
  "admin:createHost": (p: { label: string; username: string; tiktok_id: string }, cb?: any) => void;
  "admin:deleteHost": (p: { id: number }, cb?: any) => void;
  "admin:setActiveHost": (p: { id: number }, cb?: any) => void;

  ping: () => void;
}


// ============================================================
// SINGLETON
// ============================================================

export function getAdminSocket(): Socket<
  AdminSocketInbound,
  AdminSocketOutbound
> {
  if (typeof window === "undefined") {
    throw new Error("getAdminSocket must run client-side");
  }

  if (globalThis.__adminSocket) {
    return globalThis.__adminSocket as any;
  }

  console.log(`⚙️ Connecting to ADMIN namespace: ${BACKEND_URL}${ADMIN_NS}`);

  const socket: Socket<
    AdminSocketInbound,
    AdminSocketOutbound
  > = io(`${BACKEND_URL}${ADMIN_NS}`, {
    path: "/socket.io",
    transports: ["websocket"],
    auth: { token: ADMIN_TOKEN },
    reconnectionAttempts: 50,
    reconnectionDelay: 1500,
    timeout: 7000,
  });

  socket.on("connect", () => {
    console.log("✅ ADMIN connected:", socket.id);

    socket.emit("ping");

    socket.emit("admin:getInitialSnapshot", {}, (snap) => {
      console.log("📦 Snapshot ontvangen");
    });

    socket.emit("admin:getHosts", {}, () => {});
  });

  socket.on("disconnect", (reason) => {
    console.warn("⚠️ ADMIN disconnected:", reason);
  });

  socket.on("connect_error", (err) => {
    console.error("❌ ADMIN connect error:", err.message);
  });

  // Keep alive
  setInterval(() => {
    try {
      socket.emit("ping");
    } catch {}
  }, 10000);

  globalThis.__adminSocket = socket;
  return socket;
}

export default getAdminSocket;
