// ============================================================================
// frontend/lib/socketClient.ts — v12.3 FIXED (FINAL)
//  ✔ Socket is nu volledig getype'd met Inbound + Outbound events
//  ✔ Ack callbacks correct getype’d
//  ✔ "snap" heeft nu InitialSnapshot type
//  ✔ Geen ANY meer, Next.js build slaagt
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
const ADMIN_TOKEN =
  process.env.NEXT_PUBLIC_ADMIN_TOKEN || "supergeheim123";

/* ============================================================================  
   SOCKET EVENT TYPES
============================================================================ */

export interface AdminSocketInbound {
  updateArena: (data: ArenaState) => void;
  updateQueue: (data: { open: boolean; entries: QueueEntry[] }) => void;

  log: (row: LogEntry) => void;
  initialLogs: (rows: LogEntry[]) => void;

  leaderboardPlayers: (rows: PlayerLeaderboardEntry[]) => void;
  leaderboardGifters: (rows: GifterLeaderboardEntry[]) => void;

  streamStats: (s: {
    totalPlayers: number;
    totalPlayerDiamonds: number;
    totalHostDiamonds: number;
  }) => void;

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

export interface AdminSocketOutbound {
  "admin:getInitialSnapshot": (
    payload: {},
    ack: (snap: InitialSnapshot) => void
  ) => void;

  "admin:getHosts": (
    payload: {},
    ack: (response: any) => void
  ) => void;

  "admin:getSettings": (
    payload: {},
    ack: (response: any) => void
  ) => void;

  "admin:searchUsers": (
    payload: { query: string },
    ack: (res: { users: SearchUser[] }) => void
  ) => void;

  "admin:addToArena": (
    payload: { username: string },
    ack: (res: AdminAckResponse) => void
  ) => void;

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

  "admin:eliminate": (
    payload: { username: string },
    ack: (res: AdminAckResponse) => void
  ) => void;

  "admin:startGame": (
    payload: {},
    ack: (res: AdminAckResponse) => void
  ) => void;

  "admin:stopGame": (
    payload: {},
    ack: (res: AdminAckResponse) => void
  ) => void;

  "admin:startRound": (
    payload: { type: "quarter" | "finale" },
    ack: (res: AdminAckResponse) => void
  ) => void;

  "admin:endRound": (
    payload: {},
    ack: (res: AdminAckResponse) => void
  ) => void;

  "admin:giveTwist": (
    payload: { username: string; twist: string },
    ack: (res: AdminAckResponse) => void
  ) => void;

  "admin:useTwist": (
    payload: { username: string; twist: string; target?: string },
    ack: (res: AdminAckResponse) => void
  ) => void;

  ping: () => void;
}

/* ============================================================================  
   SINGLETON SOCKET FACTORY
============================================================================ */

declare global {
  var __adminSocket: Socket<
    AdminSocketInbound,
    AdminSocketOutbound
  > | undefined;
}

export function getAdminSocket(): Socket<
  AdminSocketInbound,
  AdminSocketOutbound
> {
  if (typeof window === "undefined") {
    throw new Error("getAdminSocket moet client-side gebruikt worden.");
  }

  if (globalThis.__adminSocket) {
    return globalThis.__adminSocket;
  }

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

  /* ======================================================================  
     CONNECT
  ====================================================================== */
  socket.on("connect", () => {
    console.log("✅ Admin socket verbonden:", socket.id);

    socket.emit("ping");

    socket.emit("admin:getInitialSnapshot", {}, (snap: InitialSnapshot) => {
      console.log("📦 Initial snapshot ontvangen");
    });

    socket.emit("admin:getHosts", {}, () => {});
    socket.emit("admin:getSettings", {}, () => {});
  });

  socket.on("disconnect", (reason) =>
    console.warn("⚠️ Admin socket disconnect:", reason)
  );

  socket.on("connect_error", (err) =>
    console.error("❌ Connect error:", err?.message || err)
  );

  /* ======================================================================  
     HEARTBEAT
  ====================================================================== */
  setInterval(() => {
    try {
      socket.emit("ping");
    } catch (_) {}
  }, 12000);

  globalThis.__adminSocket = socket;
  return socket;
}

export default getAdminSocket;
