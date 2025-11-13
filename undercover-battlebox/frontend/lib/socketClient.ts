// src/lib/socketClient.ts — v1.2 stable singleton

import { io, Socket } from "socket.io-client";

// ⚙️ BACKEND URL
const BACKEND_URL = "http://178.251.232.12:4000";

// Admin token
const ADMIN_TOKEN = process.env.NEXT_PUBLIC_ADMIN_TOKEN || "supergeheim123";

// SINGLETON
let adminSocket: Socket | null = null;

export function getAdminSocket(): Socket {
  if (!adminSocket) {
    console.log(`⚙️ Verbinden met backend: ${BACKEND_URL}`);

    adminSocket = io(BACKEND_URL, {
      transports: ["polling", "websocket"],
      path: "/socket.io",
      auth: { token: ADMIN_TOKEN },
      reconnection: true,
      reconnectionAttempts: 50,
      reconnectionDelay: 1500,
    });

    adminSocket.on("connect", () => {
      console.log(`✅ Admin socket connected → ${adminSocket!.id}`);
    });

    adminSocket.on("disconnect", (reason) => {
      console.warn("⚠️ Admin socket disconnected:", reason);
    });

    adminSocket.on("connect_error", (err: any) => {
      console.error("❌ Admin socket connect error:", err?.message || err);
    });
  }

  return adminSocket;
}
