// ============================================================================
// frontend/lib/socketClient.ts — v12.2 FIXED NAMESPACE
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

declare global {
  var __adminSocket: Socket | undefined;
}

export function getAdminSocket(): Socket {
  if (typeof window === "undefined") {
    throw new Error("getAdminSocket moet client-side gebruikt worden.");
  }

  if (globalThis.__adminSocket) {
    return globalThis.__adminSocket as any;
  }

  console.log(`⚙️ Verbinden met backend socket: ${BACKEND_URL}/admin`);

  const socket: Socket = io(`${BACKEND_URL}/admin`, {
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

    socket.emit("admin:getInitialSnapshot", {}, (snap) => {
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

  // Heartbeat
  setInterval(() => {
    try {
      socket.emit("ping");
    } catch (_) {}
  }, 12000);

  globalThis.__adminSocket = socket;
  return socket;
}

export default getAdminSocket;
