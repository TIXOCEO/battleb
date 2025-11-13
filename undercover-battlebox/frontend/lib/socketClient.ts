// src/lib/socketClient.ts
import { io, Socket } from "socket.io-client";
import type { ArenaState, QueueEntry, LogEntry } from "./adminTypes";

// 👇 HARD FIX → gebruik altijd jouw server-IP
const BACKEND_URL = "http://178.251.232.12:4000";

// Admin token
const ADMIN_TOKEN = process.env.NEXT_PUBLIC_ADMIN_TOKEN || "supergeheim123";

let socket: Socket | null = null;

export type SocketEvents = {
  updateArena: (data: ArenaState) => void;
  updateQueue: (data: { open: boolean; entries: QueueEntry[] }) => void;
  log: (data: LogEntry) => void;
  roundStart: (data: { round: number; type: string }) => void;
  roundEnd: (data: { round: number; type: string }) => void;
};

export function getAdminSocket(): Socket {
  if (!socket) {
    console.log(`⚙️ Socket verbinden met: ${BACKEND_URL}`);

    socket = io(BACKEND_URL, {
      //
      // Belangrijk: eerst polling → daarna upgrade naar websocket
      //
      transports: ["polling", "websocket"],
      path: "/socket.io",
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
      console.error(
        `❌ Socket connectie-fout (${BACKEND_URL}):`,
        err.message
      );
    });
  }

  return socket;
}
