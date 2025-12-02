// ============================================================================
// shared/socket.ts — BattleBox Overlay Socket Client v1.0
// Connects OBS Overlay → Backend Socket Server
// Stable for Next.js 15, BrowserSources (OBS), and Overlay iFrames
// ============================================================================

import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

// ----------------------------------------------------------------------------
// CONFIG
// ----------------------------------------------------------------------------

const SOCKET_URL = "http://178.251.232.12:4000";   // <—— jouw backend socket
const FRONTEND_URL = "http://178.251.232.12:3000"; // <—— overlay domain

// ----------------------------------------------------------------------------
// INIT FUNCTION — only runs once (safe for OBS multiple loads)
// ----------------------------------------------------------------------------

export function getSocket(): Socket {
  if (socket) return socket;

  socket = io(SOCKET_URL, {
    path: "/socket.io",
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionAttempts: Infinity,
    secure: false,
    withCredentials: false,

    extraHeaders: {
      "x-overlay-origin": FRONTEND_URL,
    }
  });

  // ----------------------------------------------------------------------------
  // DEBUG LOGS  (Kan later uit)
  // ----------------------------------------------------------------------------
  socket.on("connect", () => {
    console.log("%c[BattleBox Socket] Connected", "color:#0fffd7;font-weight:bold;");
  });

  socket.on("disconnect", () => {
    console.log("%c[BattleBox Socket] Disconnected", "color:#ff4d4f;font-weight:bold;");
  });

  socket.on("connect_error", (err) => {
    console.log("%c[BattleBox Socket] ERROR:", "color:#ff4d4f;font-weight:bold;", err.message);
  });

  return socket;
}
