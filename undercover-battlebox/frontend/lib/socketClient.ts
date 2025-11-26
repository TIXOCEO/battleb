// ============================================================================
// frontend/lib/socketClient.ts — BattleBox v13.0 (STORELESS VERSION)
// Realtime backend connector — volledig in sync met backend/adminTypes
// ============================================================================

import { io, Socket } from "socket.io-client";

import type {
  ArenaState,
  QueueEntry,
  LogEntry,
  PlayerLeaderboardEntry,
  GifterLeaderboardEntry,
  ArenaSettings,
  InitialSnapshot,
  HostProfile,

  AdminSocketInbound,
  AdminSocketOutbound,
} from "./adminTypes";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://178.251.232.12:4000";

const ADMIN_TOKEN =
  process.env.NEXT_PUBLIC_ADMIN_TOKEN || "supergeheim123";

// ============================================================================
// SINGLETON
// ============================================================================
declare global {
  // eslint-disable-next-line no-var
  var __adminSocket: Socket<AdminSocketInbound, AdminSocketOutbound> | undefined;
}

// ============================================================================
// MAIN SOCKET
// ============================================================================
export function getAdminSocket(): Socket<
  AdminSocketInbound,
  AdminSocketOutbound
> {
  if (typeof window === "undefined") {
    throw new Error("getAdminSocket moet client-side worden gebruikt.");
  }

  if (globalThis.__adminSocket) return globalThis.__adminSocket;

  const socket = io(BACKEND_URL, {
    transports: ["websocket", "polling"],
    path: "/socket.io",
    auth: { token: ADMIN_TOKEN, role: "admin" },
  }) as Socket<AdminSocketInbound, AdminSocketOutbound>;

  // ==========================================================================
  // CONNECT
  // ==========================================================================
  socket.on("connect", () => {
    console.log("✔ Verbonden met backend");

    socket.emit("ping");

    socket.emit("getInitialSnapshot", {}, (snap: InitialSnapshot) => {});
    socket.emit("getHosts", {}, () => {});
    socket.emit("getSettings", {}, () => {});
  });

  // ==========================================================================
  // DISCONNECT / ERRORS
  // ==========================================================================
  socket.on("disconnect", (reason) => {
    console.warn("⚠ Verbinding verbroken:", reason);
  });

  socket.on("connect_error", (err) => {
    console.error("❌ Verbinding mislukt:", err.message);
  });

  // ==========================================================================
  // KEEP ALIVE
  // ==========================================================================
  setInterval(() => {
    try {
      socket.emit("ping");
    } catch {}
  }, 10000);

  // ==========================================================================
  // INBOUND EVENTS
  // ==========================================================================
  socket.on("updateArena", (_arena: ArenaState) => {});
  socket.on("updateQueue", (_q: { open: boolean; entries: QueueEntry[] }) => {});
  socket.on("log", (_log: LogEntry) => {});
  socket.on("initialLogs", (_rows: LogEntry[]) => {});
  socket.on("leaderboardPlayers", (_rows: PlayerLeaderboardEntry[]) => {});
  socket.on("leaderboardGifters", (_rows: GifterLeaderboardEntry[]) => {});
  socket.on("streamStats", (_stats: any) => {});
  socket.on("gameSession", (_s) => {});
  socket.on("hosts", (_rows: HostProfile[]) => {});
  socket.on("hostsActiveChanged", (_p) => {});
  socket.on("settings", (_settings: ArenaSettings) => {});

  socket.on("round:start", (_d: any) => {});
  socket.on("round:grace", (_d: any) => {});
  socket.on("round:end", () => {});

  socket.on("hostDiamonds", (_d: { username: string; total: number }) => {});

  // ❌ VERWIJDERD: socket.on("pong")

  globalThis.__adminSocket = socket;
  return socket;
}

export default getAdminSocket;
