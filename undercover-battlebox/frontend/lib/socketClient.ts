// src/lib/socketClient.ts
import { io, Socket } from "socket.io-client";
import type { ArenaState, QueueEntry, LogEntry } from "./adminTypes";

// 🔗 Altijd jouw backend-IP gebruiken
const BACKEND_URL = "http://178.251.232.12:4000";

// Admin token
const ADMIN_TOKEN = process.env.NEXT_PUBLIC_ADMIN_TOKEN || "supergeheim123";

// ✅ ECHTE SINGLETON VIA GLOBAL
declare global {
  // eslint-disable-next-line no-var
  var __adminSocket: Socket | undefined;
}

// Types voor inkomende socket events (optioneel)
export type SocketEvents = {
  updateArena: (data: ArenaState) => void;
  updateQueue: (data: { open: boolean; entries: QueueEntry[] }) => void;
  log: (data: LogEntry) => void;
  roundStart: (data: { round: number; type: string }) => void;
  roundEnd: (data: { round: number; type: string }) => void;
};

export function getAdminSocket(): Socket {
  if (typeof window === "undefined") {
    throw new Error("getAdminSocket mag alleen in client components worden gebruikt.");
  }

  // ➜ als socket al bestaat (ook na route switch / HMR): zelfde instantie gebruiken
  if (globalThis.__adminSocket) {
    return globalThis.__adminSocket;
  }

  console.log(`⚙️ Socket verbinden met: ${BACKEND_URL}`);

  const s = io(BACKEND_URL, {
    // Belangrijk: eerst polling → daarna upgrade naar websocket
    transports: ["polling", "websocket"],
    path: "/socket.io",
    auth: { token: ADMIN_TOKEN, role: "admin" },
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelay: 1500,
  });

  s.on("connect", () => {
    console.log(`✅ Verbonden met backend: ${BACKEND_URL}`);
  });

  s.on("disconnect", (reason) => {
    console.warn(`⚠️ Verbinding verbroken (${reason})`);
  });

  s.on("connect_error", (err) => {
    console.error(`❌ Socket connectie-fout (${BACKEND_URL}):`, err.message);
  });

  globalThis.__adminSocket = s;
  return s;
}

// Zorg dat dit een module is voor TS (ivm declare global)
export {};
