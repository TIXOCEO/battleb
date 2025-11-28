// ============================================================================
// frontend/lib/socketClient.ts — BattleBox v16 (SYNCED EDITION)
// ✔ Realtime backend connector — volledig in sync met backend v16 & adminTypes v16
// ✔ Nieuwe outbound commands toegevoegd (promoteUser, demoteUser, giveVip, removeVip)
// ✔ Volledig backward compatible — rest van code NIET aangepast
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
// SOCKET SINGLETON
// ============================================================================
declare global {
  // eslint-disable-next-line no-var
  var __adminSocket: Socket<AdminSocketInbound, AdminSocketOutbound> | undefined;
}

// ============================================================================
// MAIN SOCKET INSTANCE
// ============================================================================
export function getAdminSocket(): Socket<
  AdminSocketInbound,
  AdminSocketOutbound
> {
  if (typeof window === "undefined") {
    throw new Error("getAdminSocket moet client-side worden gebruikt.");
  }

  // Singleton
  if (globalThis.__adminSocket) return globalThis.__adminSocket;

  // ==========================================================================
  // INIT SOCKET
  // ==========================================================================
  const socket = io(BACKEND_URL, {
    transports: ["websocket", "polling"],
    path: "/socket.io",
    auth: { token: ADMIN_TOKEN, role: "admin" },
  }) as Socket<AdminSocketInbound, AdminSocketOutbound>;

  // ==========================================================================
  // CONNECT
  // ==========================================================================
  socket.on("connect", () => {
    console.log("✔ Verbonden met BattleBox-backend");

    socket.emit("ping");

    // Initial snapshot ophalen
    socket.emit("getInitialSnapshot", {}, (_snap: InitialSnapshot) => {});

    // Hosts ophalen
    socket.emit("getHosts", {}, () => {});
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
  // INBOUND EVENTS (Backend → Frontend)
  // ==========================================================================
  socket.on("updateArena", (_arena: ArenaState) => {});
  socket.on("updateQueue", (_q: { open: boolean; entries: QueueEntry[] }) => {});

  socket.on("log", (_log: LogEntry) => {});
  socket.on("initialLogs", (_rows: LogEntry[]) => {});

  socket.on("leaderboardPlayers", (_rows: PlayerLeaderboardEntry[]) => {});
  socket.on("leaderboardGifters", (_rows: GifterLeaderboardEntry[]) => {});

  socket.on("streamStats", (_stats) => {});
  socket.on("gameSession", (_session) => {});

  socket.on("hosts", (_hosts: HostProfile[]) => {});
  socket.on("hostsActiveChanged", (_payload) => {});

  socket.on("settings", (_s: ArenaSettings) => {});

  socket.on("round:start", (_data) => {});
  socket.on("round:grace", (_data) => {});
  socket.on("round:end", (_data) => {});

  socket.on("hostDiamonds", (_d: { username: string; total: number }) => {});

  // ==========================================================================
  // OUTBOUND — Alleen type support, geen implementatie nodig
  // ==========================================================================
  //
  // De nieuwe admin actions zijn:
  //
  //  ✔ promoteUser
  //  ✔ demoteUser
  //  ✔ giveVip
  //  ✔ removeVip
  //  ✔ addToQueue
  //  ✔ removeFromQueue
  //  ✔ addToArena (queue → arena)
  //
  // Ze zijn beschikbaar via:
  //    const socket = getAdminSocket();
  //    socket.emit("promoteUser", { username }, ack => ...)
  //
  // Geen extra code nodig — types zijn reeds gekoppeld.
  //

  globalThis.__adminSocket = socket;
  return socket;
}

export default getAdminSocket;
