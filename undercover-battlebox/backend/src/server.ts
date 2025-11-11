// src/server.ts — BATTLEBOX 5-ENGINE – ADMIN DASHBOARD LIVE – PERSISTENTE QUEUE & LOGS
import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import { initDB } from "./db";
import pool from "./db";
import cors from "cors";
import dotenv from "dotenv";

import { startConnection } from "./engines/1-connection";
import { getOrUpdateUser } from "./engines/2-user-engine";
import { initGiftEngine } from "./engines/3-gift-engine";
import { addBP } from "./engines/4-points-engine";
import {
  initGame,
  arenaJoin,
  arenaLeave,
  arenaClear,
  getArena,
  emitArena,
} from "./engines/5-game-engine";
import { addToQueue, getQueue } from "./queue";

dotenv.config();

if (!process.env.TIKTOK_USERNAME) {
  console.error("FATAL: TIKTOK_USERNAME ontbreekt in .env!");
  process.exit(1);
}

const ADMIN_TOKEN = "supergeheim123";

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);

export const io = new Server(server, {
  cors: { origin: "*" },
  path: "/socket.io",
});

type LogEntry = {
  id: string;
  timestamp: string;
  type: string;
  message: string;
  [key: string]: any;
};

const LOG_MAX = 500;
const logBuffer: LogEntry[] = [];

app.get("/queue", async (_req, res) => {
  const entries = await getQueue();
  res.json({ open: true, entries });
});

app.get("/arena", async (_req, res) => res.json(getArena()));
app.get("/logs", (_req, res) => res.json({ logs: logBuffer }));

const requireAdmin = (req: any, res: any, next: any) => {
  const auth = req.headers.authorization;
  if (auth === `Bearer ${ADMIN_TOKEN}`) return next();
  res.status(401).json({ success: false, message: "Unauthorized" });
};

interface AdminSocket extends Socket {
  isAdmin?: boolean;
}

io.use((socket: any, next) => {
  const token = socket.handshake.auth?.token;
  if (token === ADMIN_TOKEN) {
    socket.isAdmin = true;
    return next();
  }
  return next(new Error("Authentication error"));
});

export async function emitQueue() {
  const entries = await getQueue();
  io.emit("updateQueue", { open: true, entries });
}

export function emitLog(
  log: Partial<LogEntry> & { type?: string; message?: string }
): void {
  const entry: LogEntry = {
    id: log.id ?? Date.now().toString(),
    timestamp: log.timestamp ?? new Date().toISOString(),
    type: log.type ?? "system",
    message: log.message ?? "(geen bericht)",
    ...log,
  };
  logBuffer.unshift(entry);
  if (logBuffer.length > LOG_MAX) logBuffer.pop();
  io.emit("log", entry);
}

function cleanUsername(username: string): string {
  return username.replace(/^@+/, "");
}

io.on("connection", async (socket: AdminSocket) => {
  if (!socket.isAdmin) {
    console.log("Unauthenticated socket attempt");
    return socket.disconnect();
  }

  console.log("ADMIN DASHBOARD VERBONDEN:", socket.id);

  socket.emit("updateArena", getArena());
  socket.emit("updateQueue", { open: true, entries: await getQueue() });
  socket.emit("initialLogs", logBuffer);

  emitLog({ type: "system", message: "Admin dashboard verbonden" });

  const handleAdminAction = async (
    action: string,
    data: any,
    ack: Function
  ) => {
    try {
      if (!data?.username) return ack({ success: false, message: "username vereist" });
      const rawInput = String(data.username).trim();
      if (!rawInput) return ack({ success: false, message: "Lege username" });

      const normalized = rawInput.replace(/^@+/, "");
      const userRes = await pool.query(
        `SELECT tiktok_id, display_name, username
         FROM users WHERE username ILIKE $1 OR username ILIKE $2 LIMIT 1`,
        [rawInput, `@${normalized}`]
      );
      if (!userRes.rows[0])
        return ack({ success: false, message: `Gebruiker ${rawInput} niet gevonden` });

      const { tiktok_id, display_name, username } = userRes.rows[0];
      const tid = tiktok_id.toString();
      const unameClean = cleanUsername(username);

      switch (action) {
        case "addToArena":
          arenaJoin(tid, display_name, username, "admin");
          await pool.query("DELETE FROM queue WHERE user_tiktok_id = $1", [tid]);
          await emitQueue();
          emitArena();
          emitLog({
            type: "join",
            message: `${display_name} (@${unameClean}) → arena`,
          });
          break;
        case "addToQueue":
          await addToQueue(tid, username);
          await emitQueue();
          emitLog({
            type: "join",
            message: `${display_name} (@${unameClean}) → wachtrij`,
          });
          break;
        case "eliminate":
          arenaLeave(tid);
          emitArena();
          emitLog({
            type: "elim",
            message: `${display_name} (@${unameClean}) geëlimineerd`,
          });
          break;
        case "removeFromQueue":
          await pool.query("DELETE FROM queue WHERE user_tiktok_id = $1", [tid]);
          await emitQueue();
          emitLog({
            type: "elim",
            message: `${display_name} (@${unameClean}) verwijderd uit wachtrij`,
          });
          break;
        default:
          return ack({
            success: false,
            message: "Onbekende actie",
          });
      }

      ack({ success: true, message: "Actie uitgevoerd" });
    } catch (err: any) {
      console.error("Admin action error:", err);
      ack({ success: false, message: err.message || "Server error" });
    }
  };

  socket.on("admin:addToArena", (d, ack) => handleAdminAction("addToArena", d, ack));
  socket.on("admin:addToQueue", (d, ack) => handleAdminAction("addToQueue", d, ack));
  socket.on("admin:eliminate", (d, ack) => handleAdminAction("eliminate", d, ack));
  socket.on("admin:removeFromQueue", (d, ack) => handleAdminAction("removeFromQueue", d, ack));
});

app.post("/api/admin/:action", requireAdmin, async (_req, res) =>
  res.json({ success: true, message: "REST endpoint klaar" })
);

const ADMIN_ID = process.env.ADMIN_TIKTOK_ID?.trim();
let conn: any = null;

initDB().then(async () => {
  server.listen(4000, () =>
    console.log("BATTLEBOX LIVE → http://localhost:4000")
  );

  initGame();

  const { conn: tikTokConn } = await startConnection(
    process.env.TIKTOK_USERNAME!,
    () => {}
  );
  conn = tikTokConn;
  initGiftEngine(conn);
});
