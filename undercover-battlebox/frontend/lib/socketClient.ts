// ============================================================================
// frontend/lib/socketClient.ts — v12.4 FIXED (MATCHES adminTypes.ts)
//  ✔ GEEN "admin:" PREFIX MEER
//  ✔ TypeScript build slaagt
//  ✔ Events exact gelijk aan backend handle()
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

const BACKEND_URL = "http://178.251.232.12:4000";
const ADMIN_TOKEN = process.env.NEXT_PUBLIC_ADMIN_TOKEN || "supergeheim123";

/* ============================================================================
   SOCKET INBOUND TYPES
============================================================================ */
export interface AdminSocketInbound {
  updateArena: (data: ArenaState) => void;
  updateQueue: (data: { open: boolean; entries: QueueEntry[] }) => void;

  log: (row: LogEntry) => void;
  initialLogs: (rows: LogEntry[]) => void;

  leaderboardPlayers: (rows: PlayerLeaderboardEntry[]) => void;
  leaderboardGifters: (rows: GifterLeaderboardEntry[]) => void;

  streamStats: (s: any) => void;

  gameSession: (s: {
    active: boolean;
    gameId: number | null;
    startedAt?: string | null;
    endedAt?: string | null;
  }) => void;

  hosts: (rows: HostProfile[]) => void;
  hostsActiveChanged: (p: { username: string; tiktok_id: string }) => void;

  settings: (s: ArenaSettings) => void;

  "round:start": (d: any) => void;
  "round:grace": (d: any) => void;
  "round:end": () => void;

  connect: () => void;
  disconnect: (reason: string) => void;
  connect_error: (err: Error) => void;
  pong: () => void;
}

/* ============================================================================
   SOCKET OUTBOUND TYPES (NO PREFIX)
============================================================================ */
export interface AdminSocketOutbound {
  ping: () => void;

  getInitialSnapshot: (
    payload: {},
    ack: (snap: InitialSnapshot) => void
  ) => void;

  getHosts: (
    payload: {},
    ack: (response: { success: boolean; hosts: HostProfile[] }) => void
  ) => void;

  getSettings: (
    payload: {},
    ack: (response: any) => void
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

  promoteUser: (
    payload: { username: string },
    ack: (res: AdminAckResponse) => void
  ) => void;

  demoteUser: (
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
}

/* ============================================================================
   SINGLETON FACTORY
============================================================================ */

declare global {
  var __adminSocket:
    | Socket<AdminSocketInbound, AdminSocketOutbound>
    | undefined;
}

export function getAdminSocket(): Socket<
  AdminSocketInbound,
  AdminSocketOutbound
> {
  if (typeof window === "undefined") {
    throw new Error("getAdminSocket moet client-side gebruikt worden.");
  }

  if (globalThis.__adminSocket) return globalThis.__adminSocket;

  console.log(`⚙️ Verbinden met backend socket: ${BACKEND_URL}/admin`);

  const socket: Socket<
    AdminSocketInbound,
    AdminSocketOutbound
  > = io(`${BACKEND_URL}/admin`, {
    transports: ["polling", "websocket"],
    path: "/socket.io",
    auth: { token: ADMIN_TOKEN, role: "admin" },
    reconnection: true,
    reconnectionAttempts: 60,
    reconnectionDelay: 1500,
    timeout: 9000,
  });

  socket.on("connect", () => {
    console.log("✅ Admin socket verbonden:", socket.id);
    socket.emit("ping");

    socket.emit("getInitialSnapshot", {}, () => {});
    socket.emit("getHosts", {}, () => {});
    socket.emit("getSettings", {}, () => {});
  });

  socket.on("disconnect", (reason) =>
    console.warn("⚠️ Admin socket disconnect:", reason)
  );

  socket.on("connect_error", (err) =>
    console.error("❌ Connect error:", err?.message || err)
  );

  // heartbeat
  setInterval(() => {
    try {
      socket.emit("ping");
    } catch (_) {}
  }, 12000);

  globalThis.__adminSocket = socket;
  return socket;
}

export default getAdminSocket;
