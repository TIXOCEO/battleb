// ============================================================================
// socketClient.ts — BATTLEBOX ADMIN FINAL v15
// 100% type-safe, geen build errors, compatibel met backend
// ============================================================================

"use client";

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

import type { AdminEventName } from "./adminEvents";

// ============================================================
// SETTINGS
// ============================================================
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL
  || "http://178.251.232.12:4000";

const ADMIN_NS = "/admin";
const ADMIN_TOKEN =
  process.env.NEXT_PUBLIC_ADMIN_TOKEN || "supersecret123";

// Singleton
declare global {
  var __adminSocket: Socket | undefined;
}

// ============================================================
// INBOUND TYPES
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

  settings: (s: ArenaSettings) => void;
  hosts: (rows: HostProfile[]) => void;

  hostsActiveChanged: (payload: {
    username: string;
    tiktok_id: string;
  }) => void;

  connectState: (payload: {
    connected: boolean;
    host?: { username: string; id: string };
  }) => void;

  pong: () => void;
}

// ============================================================
// OUTBOUND TYPES (alle admin:* events toegestaan)
// ============================================================
export type AdminSocketOutbound = Record<
  AdminEventName,
  (payload?: any, cb?: (res: any) => void) => void
> & {
  ping: () => void;
};

// ============================================================
// SINGLETON SOCKET
// ============================================================
export function getAdminSocket(): Socket<
  AdminSocketInbound,
  AdminSocketOutbound
> {
  if (typeof window === "undefined") {
    throw new Error("getAdminSocket() moet client-side zijn");
  }

  if (globalThis.__adminSocket) {
    return globalThis.__adminSocket as any;
  }

  console.log(
    `⚙️ Verbinden met ADMIN namespace: ${BACKEND_URL}${ADMIN_NS}`
  );

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

  // ----------------------------------------------------------
  // CONNECT EVENTS
  // ----------------------------------------------------------
  socket.on("connect", () => {
    console.log("✅ ADMIN connected:", socket.id);

    socket.emit("ping");

    socket.emit("admin:getInitialSnapshot", {}, () => {
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
