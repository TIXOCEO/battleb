// ============================================================================
// socket.js — BattleBox Overlay Socket Client v2.0 (SYNC FIXED EDITION)
// ----------------------------------------------------------------------------
// ✔️ 100% sync getSocket() — werkt met arena.js v9.6 en event-router
// ✔️ 1 gedeelde instance
// ✔️ Geen async/await meer (fix for socket.on is not a function)
// ✔️ OBS-safe, browser-safe
// ============================================================================

import { io } from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js";

let socketInstance = null;

// Backend URL
const SOCKET_URL = "http://178.251.232.12:4000";

/**
 * Returns a single ready socket instance (sync).
 * arena.js expects: const socket = getSocket(); socket.on(...)
 */
export function getSocket() {
  // Already created?
  if (socketInstance) return socketInstance;

  // Create socket
  socketInstance = io(SOCKET_URL, {
    transports: ["websocket"],
    path: "/socket.io",
    auth: { type: "overlay" },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
  });

  socketInstance.on("connect", () => {
    console.log(
      "%c[BattleBox Socket] Connected (Overlay)",
      "color:#0fffd7;font-weight:bold;"
    );
  });

  socketInstance.on("disconnect", () => {
    console.log(
      "%c[BattleBox Socket] Disconnected",
      "color:#ff4d4f;font-weight:bold;"
    );
  });

  socketInstance.on("connect_error", (err) => {
    console.warn(
      "%c[BattleBox Socket] ERROR",
      "color:#ff4d4f;font-weight:bold;",
      err?.message
    );
  });

  return socketInstance;
}

export default getSocket;
