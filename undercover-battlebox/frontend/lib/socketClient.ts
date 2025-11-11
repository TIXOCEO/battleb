// lib/socketClient.ts
import { io, Socket } from "socket.io-client";
import type { ArenaState, QueueEntry, LogEntry } from "./adminTypes";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
const ADMIN_TOKEN = process.env.NEXT_PUBLIC_ADMIN_TOKEN ?? "";

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
    socket = io(BACKEND_URL, {
      transports: ["websocket"],
      auth: { token: ADMIN_TOKEN, role: "admin" },
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socket.on("connect", () => {
      console.log("✅ Verbonden met backend admin socket");
    });

    socket.on("connect_error", (err) => {
      console.error("❌ Socket connectie-fout:", err.message);
    });
  }

  return socket;
}
