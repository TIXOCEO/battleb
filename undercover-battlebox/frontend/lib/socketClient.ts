// frontend/lib/socketClient.ts
import { io, Socket } from "socket.io-client";
import type {
  ArenaState,
  QueueEntry,
  LogEntry,
  AdminAckResponse,
  PlayerLeaderboardEntry,
  GifterLeaderboardEntry,
  SearchUser,
} from "./adminTypes";

const BACKEND_URL = "http://178.251.232.12:4000";

const ADMIN_TOKEN =
  process.env.NEXT_PUBLIC_ADMIN_TOKEN || "supergeheim123";

declare global {
  // eslint-disable-next-line no-var
  var __adminSocket: Socket | undefined;
}

/* ============================================================
   INBOUND: SERVER → CLIENT EVENTS (TYPESAFE)
============================================================ */
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

  // autocomplete
  "admin:searchUsers:result": (res: { users: SearchUser[] }) => void;

  // VIP/FAN auto-expire
  vipExpired: (payload: { username: string; tiktok_id: string }) => void;
  fanExpired: (payload: { username: string; tiktok_id: string }) => void;

  pong: () => void;
}

/* ============================================================
   OUTBOUND: CLIENT → SERVER EVENTS (TYPESAFE)
============================================================ */
export interface AdminSocketOutbound {
  // User actions
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

  // VIP / FAN
  "admin:giveVip": (
    payload: { username: string },
    cb?: (res: AdminAckResponse) => void
  ) => void;

  "admin:removeVip": (
    payload: { username: string },
    cb?: (res: AdminAckResponse) => void
  ) => void;

  "admin:giveFan": (
    payload: { username: string },
    cb?: (res: AdminAckResponse) => void
  ) => void;

  // twists
  "admin:giveTwist": (
    payload: any,
    cb?: (res: AdminAckResponse) => void
  ) => void;

  "admin:useTwist": (
    payload: any,
    cb?: (res: AdminAckResponse) => void
  ) => void;

  // rounds
  "admin:startRound": (
    payload: { type: "quarter" | "finale" },
    cb?: (res: AdminAckResponse) => void
  ) => void;

  "admin:endRound": (
    payload?: {},
    cb?: (res: AdminAckResponse) => void
  ) => void;

  // game control
  "admin:startGame": (
    payload?: {},
    cb?: (res: AdminAckResponse) => void
  ) => void;

  "admin:stopGame": (
    payload?: {},
    cb?: (res: AdminAckResponse) => void
  ) => void;

  // settings
  "admin:getSettings": (
    payload?: {},
    cb?: (res: any) => void
  ) => void;

  "admin:updateSettings": (
    payload: any,
    cb?: (res: AdminAckResponse) => void
  ) => void;

  // initial sync (after reconnect)
  "admin:getInitialState": (
    payload?: {},
    cb?: (res: any) => void
  ) => void;

  // autocomplete
  "admin:searchUsers": (
    payload: { query: string },
    cb: (res: { users: SearchUser[] }) => void
  ) => void;

  // ping
  ping: () => void;
}

/* ============================================================
   SINGLETON SOCKET INSTANCE
============================================================ */
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
    reconnectionAttempts: 80,
    reconnectionDelay: 1500,
    timeout: 8000,
  });

  // RECONNECT-SYNC
  socket.on("connect", () => {
    console.log("✅ Admin socket verbonden:", socket.id);

    socket.emit("ping");
    socket.emit("admin:getInitialState", {}, () => {});
    socket.emit("admin:getSettings", {}, () => {});
  });

  socket.on("disconnect", (reason) => {
    console.warn("⚠️ Socket disconnect:", reason);
  });

  socket.on("connect_error", (err) => {
    console.error("❌ Connect error:", err?.message || err);
  });

  // Heartbeat
  setInterval(() => {
    try {
      socket.emit("ping");
    } catch {}
  }, 12_000);

  globalThis.__adminSocket = socket;
  return socket;
}

export default getAdminSocket;
