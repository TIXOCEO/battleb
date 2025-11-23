// frontend/lib/socketClient.ts
import { io, Socket } from "socket.io-client";
import type {
  ArenaState,
  QueueEntry,
  LogEntry,
  AdminAckResponse,
  PlayerLeaderboardEntry,
  GifterLeaderboardEntry,
} from "./adminTypes";

const BACKEND_URL = "http://178.251.232.12:4000";

const ADMIN_TOKEN =
  process.env.NEXT_PUBLIC_ADMIN_TOKEN || "supergeheim123";

declare global {
  // eslint-disable-next-line no-var
  var __adminSocket: Socket | undefined;
}

/* ===========================================
   ALL SERVER → CLIENT EVENTS (TYPESAFE)
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

  // search / autocomplete
  "admin:searchUsers:result": (res: { users: any[] }) => void;

  // VIP / FAN auto-expire
  vipExpired: (payload: { username: string; tiktok_id: string }) => void;
  fanExpired: (payload: { username: string; tiktok_id: string }) => void;

  // Health check
  pong: () => void;
}

/* ===========================================
    OUTBOUND ADMIN COMMAND EVENTS
=========================================== */
export interface AdminSocketOutbound {
  // user actions
  "admin:addToArena": (payload: { username: string }, cb?: AdminAckResponse) => void;
  "admin:addToQueue": (payload: { username: string }, cb?: AdminAckResponse) => void;
  "admin:removeFromQueue": (
    payload: { username: string },
    cb?: AdminAckResponse
  ) => void;
  "admin:promoteUser": (
    payload: { username: string },
    cb?: AdminAckResponse
  ) => void;
  "admin:demoteUser": (
    payload: { username: string },
    cb?: AdminAckResponse
  ) => void;

  "admin:eliminate": (payload: { username: string }, cb?: AdminAckResponse) => void;

  // VIP / FAN
  "admin:giveVip": (payload: { username: string }, cb?: AdminAckResponse) => void;
  "admin:removeVip": (payload: { username: string }, cb?: AdminAckResponse) => void;
  "admin:giveFan": (payload: { username: string }, cb?: AdminAckResponse) => void;

  // twist system
  "admin:giveTwist": (payload: any, cb?: AdminAckResponse) => void;
  "admin:useTwist": (payload: any, cb?: AdminAckResponse) => void;

  // rounds
  "admin:startRound": (payload: any, cb?: AdminAckResponse) => void;
  "admin:endRound": (payload?: {}, cb?: AdminAckResponse) => void;

  // game control
  "admin:startGame": (payload?: {}, cb?: AdminAckResponse) => void;
  "admin:stopGame": (payload?: {}, cb?: AdminAckResponse) => void;

  // autocomplete
  "admin:searchUsers": (
    payload: { query: string },
    cb: (data: { users: any[] }) => void
  ) => void;

  // health check
  ping: () => void;
}

/* ===========================================
   SINGLETON SOCKET CLIENT
=========================================== */
export function getAdminSocket(): Socket<AdminSocketInbound, AdminSocketOutbound> {
  if (typeof window === "undefined") {
    throw new Error("getAdminSocket moet client-side gebruikt worden.");
  }

  if (globalThis.__adminSocket) {
    return globalThis.__adminSocket as any;
  }

  console.log(`⚙️ Verbinden met backend socket: ${BACKEND_URL}`);

  const socket: Socket<AdminSocketInbound, AdminSocketOutbound> = io(
    BACKEND_URL,
    {
      transports: ["polling", "websocket"],
      path: "/socket.io",
      auth: { token: ADMIN_TOKEN, role: "admin" },
      reconnection: true,
      reconnectionAttempts: 60,
      reconnectionDelay: 1500,
      timeout: 9000,
    }
  );

  /* ===========================================
     AUTO-RESYNC NA RECONNECT
  ============================================ */
  socket.on("connect", () => {
    console.log("✅ Admin socket verbonden:", socket.id);
    socket.emit("ping");

    // volledige refresh bij reconnect:
    socket.emit("admin:searchUsers", { query: "" }, () => {});
    socket.emit("admin:getInitialState", {}, () => {});
  });

  socket.on("disconnect", (reason) => {
    console.warn("⚠️ Admin socket disconnect:", reason);
  });

  socket.on("connect_error", (err) => {
    console.error("❌ Connect error:", err?.message || err);
  });

  /* heartbeat */
  setInterval(() => {
    try {
      socket.emit("ping");
    } catch (e) {}
  }, 12000);

  globalThis.__adminSocket = socket;
  return socket;
}

export default getAdminSocket;
