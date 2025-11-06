// backend/src/server.ts
import express from "express";
import http from "http";
import { Server } from "socket.io";
import { WebcastPushConnection } from "tiktok-live-connector";
import { initDB } from "./db";
import pool from "./db";
import { addToQueue, boostQueue, leaveQueue, getQueue } from "./queue";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.get("/queue", async (_req, res) => {
  const queue = await getQueue();
  res.json(queue);
});

io.on("connection", (socket) => {
  console.log("Overlay connected:", socket.id);
  emitQueue();
});

async function emitQueue() {
  const queue = await getQueue();
  io.emit("queue:update", queue.slice(0, 50));
}

const ADMIN_ID = process.env.ADMIN_TIKTOK_ID?.trim();

// === Verbinding met TikTok met retry ===
async function connectWithRetry(
  username: string,
  retries = 6
): Promise<WebcastPushConnection> {
  for (let i = 0; i < retries; i++) {
    try {
      const conn = new WebcastPushConnection(username);
      await conn.connect();
      console.info(`Verbonden met TikTok Live! (poging ${i + 1})`);
      return conn;
    } catch (err: any) {
      console.error(
        `Connectie mislukt (poging ${i + 1}/${retries}):`,
        err.message || err
      );
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 7000));
    }
  }
  throw new Error("Definitief geen verbinding met TikTok Live");
}

// === Fan activatie (Heart Me) ===
async function activateFanStatus(tiktok_id: bigint, display_name: string) {
  await pool.query(
    `INSERT INTO users (tiktok_id, display_name, username, bp_total, is_fan, fan_expires_at)
     VALUES ($1, $2, $2, 0, true, NOW() + INTERVAL '24 hours')
     ON CONFLICT (tiktok_id) 
     DO UPDATE SET 
       is_fan = true, 
       fan_expires_at = NOW() + INTERVAL '24 hours',
       display_name = EXCLUDED.display_name,
       username = EXCLUDED.display_name`,
    [tiktok_id, display_name]
  );
  console.log(`[FAN ACTIVATED 24H] ${display_name} (ID: ${tiktok_id})`);
}

// === User data ophalen of aanmaken ===
async function getUserData(tiktok_id: bigint, display_name: string) {
  const query = `
    INSERT INTO users (tiktok_id, display_name, username, bp_total, is_fan, fan_expires_at, is_vip)
    VALUES ($1, $2, $2, 0, false, NULL, false)
    ON CONFLICT (tiktok_id) 
    DO UPDATE SET display_name = EXCLUDED.display_name, username = EXCLUDED.display_name
    RETURNING bp_total, is_fan, fan_expires_at, is_vip;
  `;

  const res = await pool.query(query, [tiktok_id, display_name]);
  const row = res.rows[0];
  const isFan =
    row.is_fan && row.fan_expires_at && new Date(row.fan_expires_at) > new Date();
  const isVip = row.is_vip === true;
  return { oldBP: parseFloat(row.bp_total) || 0, isFan, isVip };
}

// === BP bijwerken ===
async function addBP(
  tiktok_id: bigint,
  amount: number,
  action: string,
  display_name: string,
  isFan: boolean,
  isVip: boolean
) {
  const oldRes = await pool.query(
    "SELECT bp_total FROM users WHERE tiktok_id = $1",
    [tiktok_id]
  );
  const oldBP = parseFloat(oldRes.rows[0]?.bp_total) || 0;

  await pool.query("UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2", [
    amount,
    tiktok_id,
  ]);

  const newRes = await pool.query(
    "SELECT bp_total FROM users WHERE tiktok_id = $1",
    [tiktok_id]
  );
  const newBP = parseFloat(newRes.rows[0].bp_total) || 0;

  const fanTag = isFan ? " [FAN]" : "";
  const vipTag = isVip ? " [VIP]" : "";
  console.log(`[${action}] ${display_name}${fanTag}${vipTag}`);
  console.log(`[BP: +${amount} | ${oldBP.toFixed(1)} → ${newBP.toFixed(1)}]`);
}

// === BP aftrekken ===
async function deductBP(tiktok_id: bigint, amount: number): Promise<boolean> {
  const res = await pool.query(
    "SELECT bp_total FROM users WHERE tiktok_id = $1 FOR UPDATE",
    [tiktok_id]
  );
  const current = parseFloat(res.rows[0]?.bp_total) || 0;
  if (current < amount) return false;
  await pool.query("UPDATE users SET bp_total = bp_total - $1 WHERE tiktok_id = $2", [
    amount,
    tiktok_id,
  ]);
  return true;
}

// === Start TikTok Live verbinding ===
async function startTikTokLive(username: string) {
  const tiktokLiveConnection = await connectWithRetry(username);

  const pendingLikes = new Map<string, number>(); // userIdStr → totaal likes
  const hasFollowed = new Set<string>();
  const nameCache = new Map<string, string>();

  // === CHAT ===
  tiktokLiveConnection.on("chat", async (data: any) => {
    const msg = (data.comment || "").toLowerCase().trim();
    if (!msg) return;

    const userId = BigInt(data.userId || data.uniqueId || "0");
    const display_name = data.nickname || "Onbekend";
    const isAdmin = userId.toString() === ADMIN_ID;

    const { isFan, isVip } = await getUserData(userId, display_name);
    await addBP(userId, 1, "CHAT", display_name, isFan, isVip);

    // ADMIN COMMANDS
    if (isAdmin && msg.startsWith("!admin ")) {
      const cmd = msg.slice(7).trim();
      if (cmd === "reset fans") {
        await pool.query("UPDATE users SET is_fan = false, fan_expires_at = NULL");
        console.log("[ADMIN] Alle fans gereset");
      }
      if (cmd.startsWith("givebp ")) {
        const parts = cmd.split(" ");
        const targetNick = parts[1];
        const amount = parseFloat(parts[2]);
        if (targetNick && amount) {
          const targetRes = await pool.query(
            "SELECT tiktok_id FROM users WHERE display_name ILIKE $1",
            [`%${targetNick}%`]
          );
          if (targetRes.rows[0]) {
            await pool.query(
              "UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2",
              [amount, targetRes.rows[0].tiktok_id]
            );
            console.log(`[ADMIN] +${amount} BP aan ${targetNick}`);
          }
        }
      }
      return;
    }

    // === KOOP COMMANDS ===
    if (msg.startsWith("!koop ")) {
      const item = msg.slice(6).trim();
      if (item === "vip") {
        if (await deductBP(userId, 5000)) {
          await pool.query("UPDATE users SET is_vip = true WHERE tiktok_id = $1", [
            userId,
          ]);
          console.log(`[KOOP] ${display_name} kocht VIP voor 5000 BP`);
        } else console.log(`[KOOP FAIL] ${display_name} onvoldoende BP voor VIP`);
        return;
      }
      if (item === "rij") {
        if (await deductBP(userId, 10000)) {
          try {
            await addToQueue(userId.toString(), display_name);
            emitQueue();
            console.log(`[KOOP] ${display_name} kocht wachtrijplek voor 10000 BP`);
          } catch (e: any) {
            await pool.query(
              "UPDATE users SET bp_total = bp_total + 10000 WHERE tiktok_id = $1",
              [userId]
            );
            console.log(`[KOOP RIJ FAIL] ${e.message}`);
          }
        } else console.log(`[KOOP FAIL] ${display_name} onvoldoende BP voor rij`);
        return;
      }
    }

    // === WACHTRIJ COMMANDS ===
    const isQueueCommand = msg === "!join" || msg.startsWith("!boost rij ") || msg === "!leave";
    if (isQueueCommand && !isFan) {
      console.log(`[NO FAN] ${display_name} probeerde !join/!boost/!leave zonder Heart Me`);
      return;
    }

    if (msg === "!join") {
      try {
        await addToQueue(userId.toString(), display_name);
        emitQueue();
      } catch (e: any) {
        console.log("Join error:", e.message);
      }
    } else if (msg.startsWith("!boost rij ")) {
      const spots = parseInt(msg.split(" ")[2] || "0");
      if (spots >= 1 && spots <= 5) {
        try {
          await boostQueue(userId.toString(), spots);
          emitQueue();
        } catch (e: any) {
          console.log("Boost error:", e.message);
        }
      }
    } else if (msg === "!leave") {
      try {
        const refund = await leaveQueue(userId.toString());
        if (refund > 0) console.log(`${display_name} kreeg ${refund} BP terug`);
        emitQueue();
      } catch (e: any) {
        console.log("Leave error:", e.message);
      }
    }
  });

  // === GIFTS ===
  tiktokLiveConnection.on("gift", async (data: any) => {
    const userId = BigInt(data.userId || data.uniqueId || "0");
    const display_name = data.nickname || "Onbekend";
    const giftName = (data.giftName || "").toLowerCase();

    if (giftName.includes("heart me")) {
      await activateFanStatus(userId, display_name);
      const { isFan, isVip } = await getUserData(userId, display_name);
      await addBP(userId, 0.5, "GIFT", display_name, isFan, isVip);
      console.log(`Heart Me → FAN ACTIVATED VOOR 24 UUR (ID: ${userId})`);
      return;
    }

    const diamonds = data.diamondCount || 0;
    if (diamonds <= 0) return;
    const giftBP = diamonds * 0.5;

    const { isFan, isVip } = await getUserData(userId, display_name);
    await addBP(userId, giftBP, "GIFT", display_name, isFan, isVip);
    console.log(`${data.giftName} (${diamonds} diamonds)`);
  });

  // === LIKES (betere meting via totalLikeCount) ===
  tiktokLiveConnection.on("like", async (data: any) => {
    const userId = BigInt(data.userId || data.uniqueId || "0");
    const userIdStr = userId.toString();
    const display_name = data.nickname || "Onbekend";
    nameCache.set(userIdStr, display_name);

    const totalLikes = data.totalLikeCount || 0;
    const previousLikes = pendingLikes.get(userIdStr) || 0;
    const newLikes = Math.max(totalLikes - previousLikes, 0);
    const newTotal = previousLikes + newLikes;

    const previousHundreds = Math.floor(previousLikes / 100);
    const newHundreds = Math.floor(newTotal / 100);
    const bpToGive = newHundreds - previousHundreds;

    if (bpToGive > 0) {
      const { isFan, isVip } = await getUserData(userId, display_name);
      await addBP(userId, bpToGive, "LIKE", display_name, isFan, isVip);
      console.log(
        `LIKE → +${bpToGive} BP voor ${display_name} (${newTotal} totaal likes)`
      );
    }

    pendingLikes.set(userIdStr, newTotal);

    // Debug
    console.log(
      `[LIKE DEBUG] ${display_name} | likeCount=${data.likeCount} | totalLikeCount=${data.totalLikeCount}`
    );
  });

  // === FOLLOW & SHARE ===
  tiktokLiveConnection.on("follow", async (data: any) => {
    const userId = BigInt(data.userId || data.uniqueId || "0");
    const userIdStr = userId.toString();
    const display_name = data.nickname || "Onbekend";
    nameCache.set(userIdStr, display_name);

    if (hasFollowed.has(userIdStr)) return;
    hasFollowed.add(userIdStr);

    const { isFan, isVip } = await getUserData(userId, display_name);
    await addBP(userId, 5, "FOLLOW", display_name, isFan, isVip);
    console.log(`Follow van ${display_name}`);
  });

  tiktokLiveConnection.on("share", async (data: any) => {
    const userId = BigInt(data.userId || data.uniqueId || "0");
    const display_name = data.nickname || "Onbekend";
    nameCache.set(userId.toString(), display_name);

    const { isFan, isVip } = await getUserData(userId, display_name);
    await addBP(userId, 5, "SHARE", display_name, isFan, isVip);
    console.log(`Share van ${display_name}`);
  });

  tiktokLiveConnection.on("streamEnd", () => {
    console.log("Stream beëindigd, sessiestate gewist.");
    pendingLikes.clear();
    hasFollowed.clear();
    nameCache.clear();
  });

  tiktokLiveConnection.on("connected", () => {
    console.log("Volledig verbonden met TikTok Live!");
  });
}

const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME || "JOUW_TIKTOK_USERNAME";

initDB().then(async () => {
  server.listen(4000, () => {
    console.log("Backend draait op :4000");
    startTikTokLive(TIKTOK_USERNAME);
  });
});
