
// src/lib/socketClient.ts
import { io, Socket } from "socket.io-client";
import type { ArenaState, QueueEntry, LogEntry } from "./adminTypes";

// 🔧 Gebruik .env.local variabele, maar verwijder eventuele trailing slash
const BACKEND_URL =
  (process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000").replace(
    /\/+$/,
    ""
  );

// Admin token uit .env.local
const ADMIN_TOKEN = process.env.NEXT_PUBLIC_ADMIN_TOKEN || "supergeheim123";

let socket: Socket | null = null;

// Types voor inkomende socket events (optioneel)
export type SocketEvents = {
  updateArena: (data: ArenaState) => void;
  updateQueue: (data: { open: boolean; entries: QueueEntry[] }) => void;
  log: (data: LogEntry) => void;
  roundStart: (data: { round: number; type: string }) => void;
  roundEnd: (data: { round: number; type: string }) => void;
};

export function getAdminSocket(): Socket {
  if (!socket) {
    console.log(`⚙️ Initialiseer socket verbinding naar: ${BACKEND_URL}`);

    socket = io(BACKEND_URL, {
      path: "/socket.io", // belangrijk: exact pad van server
      transports: ["websocket"],
      auth: { token: ADMIN_TOKEN, role: "admin" },
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1500,
    });

    socket.on("connect", () => {
      console.log(`✅ Verbonden met backend: ${BACKEND_URL}`);
    });

    socket.on("disconnect", (reason) => {
      console.warn(`⚠️ Verbinding verbroken (${reason})`);
    });

    socket.on("connect_error", (err) => {
      console.error(`❌ Socket connectie-fout (${BACKEND_URL}):`, err.message);
    });
  }

  return socket;
}
