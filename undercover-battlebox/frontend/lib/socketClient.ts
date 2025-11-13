// frontend/lib/socketClient.ts
import { io, Socket } from "socket.io-client";
import type { ArenaState, QueueEntry, LogEntry } from "./adminTypes";

// Backend URL
const BACKEND_URL = "http://178.251.232.12:4000";

// Admin token
const ADMIN_TOKEN =
  process.env.NEXT_PUBLIC_ADMIN_TOKEN || "supergeheim123";

// GLOBAL SINGLETON (Next.js safe)
declare global {
  // eslint-disable-next-line no-var
  var __adminSocket: Socket | undefined;
}

// Types voor inkomende events
export type SocketEvents = {
  updateArena: (data: ArenaState) => void;
  updateQueue: (data: { open: boolean; entries: QueueEntry[] }) => void;
  log: (data: LogEntry) => void;
  roundStart: (data: { round: number; type: string }) => void;
  roundEnd: (data: { round: number; type: string }) => void;
};

// ✔ Nooit server side aanmaken
// ✔ Nooit disconnecten in components
// ✔ Nooit dubbele instantiaties
// ✔ Werkt over meerdere admin pagina's (Dashboard ↔ Settings)

export function getAdminSocket(): Socket {
  if (typeof window === "undefined") {
    throw new Error("getAdminSocket moet client-side gebruikt worden.");
  }

  // Socket bestaat al? Gebruik die.
  if (globalThis.__adminSocket) {
    return globalThis.__adminSocket;
  }

  console.log(`⚙️ Verbinden met backend socket: ${BACKEND_URL}`);

  const socket = io(BACKEND_URL, {
    transports: ["polling", "websocket"],
    path: "/socket.io",
    auth: { token: ADMIN_TOKEN, role: "admin" },
    reconnection: true,
    reconnectionAttempts: 40,
    reconnectionDelay: 1200,
  });

  socket.on("connect", () => {
    console.log("✅ Admin socket verbonden:", socket.id);
  });

  socket.on("disconnect", (reason) => {
    console.warn("⚠️ Admin socket disconnect:", reason);
  });

  socket.on("connect_error", (err) => {
    console.error("❌ Connect error:", err.message);
  });

  globalThis.__adminSocket = socket;
  return socket;
}

export {};
