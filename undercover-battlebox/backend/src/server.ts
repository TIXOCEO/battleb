// backend/src/server.ts
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { WebcastPushConnection } from 'tiktok-live-connector';
import { initDB } from './db';
import pool from './db';
import { addToQueue, boostQueue, leaveQueue, getQueue } from './queue';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.get('/queue', async (req, res) => {
  const queue = await getQueue();
  res.json(queue);
});

io.on('connection', (socket) => {
  console.log('Overlay connected:', socket.id);
  emitQueue();
});

async function emitQueue() {
  const queue = await getQueue();
  io.emit('queue:update', queue.slice(0, 50));
}

const hasFollowed = new Set<string>();
const pendingLikes = new Map<string, number>();
const ADMIN_ID = process.env.ADMIN_TIKTOK_ID?.trim();

// AUTO-RETRY BIJ SIGN ERROR
async function connectWithRetry(username: string, retries = 6): Promise<WebcastPushConnection> {
  for (let i = 0; i < retries; i++) {
    try {
      const conn = new WebcastPushConnection(username);
      await conn.connect();
      console.info(`Verbonden met TikTok Live! (poging ${i + 1})`);
      return conn;
    } catch (err: any) {
      console.error(`Connectie mislukt (poging ${i + 1}/${retries}):`, err.message || err);
      if (i < retries - 1) await new Promise(r => setTimeout(r, 7000));
    }
  }
  throw new Error('Definitief geen verbinding met TikTok Live');
}

// HEART ME = FAN VOOR 24 UUR
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

// HAAL USER + FAN/VIP OP
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

  const isFan = row.is_fan && row.fan_expires_at && new Date(row.fan_expires_at) > new Date();
  const isVip = row.is_vip === true;

  if (!row.bp_total) console.log(`[NEW USER] ${display_name} (ID: ${tiktok_id})`);

  return { oldBP: parseFloat(row.bp_total) || 0, isFan, isVip };
}

// BP TOEVOEGEN
async function addBP(tiktok_id: bigint, amount: number, action: string, display_name: string, isFan: boolean, isVip: boolean) {
  const oldRes = await pool.query('SELECT bp_total FROM users WHERE tiktok_id = $1', [tiktok_id]);
  const oldBP = parseFloat(oldRes.rows[0]?.bp_total) || 0;

  await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [amount, tiktok_id]);

  const newRes = await pool.query('SELECT bp_total FROM users WHERE tiktok_id = $1', [tiktok_id]);
  const newBP = parseFloat(newRes.rows[0].bp_total) || 0;

  const fanTag = isFan ? ' [FAN]' : '';
  const vipTag = isVip ? ' [VIP]' : '';
  console.log(`[${action}] ${display_name}${fanTag}${vipTag}`);
  console.log(`[BP: +${amount} | ${oldBP.toFixed(1)} → ${newBP.toFixed(1)}]`);
}

// BP AFTREKKEN
async function deductBP(tiktok_id: bigint, amount: number): Promise<boolean> {
  const res = await pool.query('SELECT bp_total FROM users WHERE tiktok_id = $1 FOR UPDATE', [tiktok_id]);
  const current = parseFloat(res.rows[0]?.bp_total) || 0;
  if (current < amount) return false;
  await pool.query('UPDATE users SET bp_total = bp_total - $1 WHERE tiktok_id = $2', [amount, tiktok_id]);
  return true;
}

async function startTikTokLive(username: string) {
  const tiktokLiveConnection = await connectWithRetry(username);

  // === CHAT ===
  tiktokLiveConnection.on('chat', async (data: any) => {
    const rawComment = data.comment || '';
    const msg = rawComment.toLowerCase().trim();
    if (!msg) return;

    const userIdRaw = data.userId || data.uniqueId || '0';
    const userId = BigInt(userIdRaw);
    const display_name = data.nickname || 'Onbekend';
    const isAdmin = userId.toString() === ADMIN_ID;

    console.log(`[CHAT] Raw: "${rawComment}" → Parsed: "${msg}" (user: ${display_name}, ID: ${userId})`);

    const { isFan, isVip } = await getUserData(userId, display_name);
    await addBP(userId, 1, 'CHAT', display_name, isFan, isVip);

    // ADMIN COMMANDS
    if (isAdmin && msg.startsWith('!admin ')) {
      const cmd = msg.slice(7).trim();
      if (cmd === 'reset fans') {
        await pool.query('UPDATE users SET is_fan = false, fan_expires_at = NULL');
        console.log('[ADMIN] Alle fans gereset');
      }
      if (cmd.startsWith('givebp ')) {
        const parts = cmd.split(' ');
        const targetNick = parts[1];
        const amount = parseFloat(parts[2]);
        if (targetNick && amount) {
          const targetRes = await pool.query('SELECT tiktok_id FROM users WHERE display_name ILIKE $1', [`%${targetNick}%`]);
          if (targetRes.rows[0]) {
            await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [amount, targetRes.rows[0].tiktok_id]);
            console.log(`[ADMIN] +${amount} BP aan ${targetNick}`);
          }
        }
      }
      return;
    }

    // !KOOP COMMANDS
    if (msg.startsWith('!koop ')) {
      const item = msg.slice(6).trim();
      if (item === 'vip') {
        if (await deductBP(userId, 5000)) {
          await pool.query('UPDATE users SET is_vip = true WHERE tiktok_id = $1', [userId]);
          console.log(`[KOOP] ${display_name} kocht VIP voor 5000 BP`);
        } else {
          console.log(`[KOOP FAIL] ${display_name} heeft niet genoeg BP voor VIP`);
        }
        return;
      }
      if (item === 'rij') {
        if (await deductBP(userId, 10000)) {
          try {
            await addToQueue(userId.toString(), display_name);
            emitQueue();
            console.log(`[KOOP] ${display_name} kocht wachtrijplek voor 10000 BP`);
          } catch (e: any) {
            await pool.query('UPDATE users SET bp_total = bp_total + 10000 WHERE tiktok_id = $1', [userId]);
            console.log(`[KOOP RIJ FAIL] ${e.message}`);
          }
        } else {
          console.log(`[KOOP FAIL] ${display_name} heeft niet genoeg BP voor rij`);
        }
        return;
      }
    }

    // === WACHTRIJ COMMANDS – ALLEEN VOOR FANS ===
    const isQueueCommand = msg === '!join' || msg.startsWith('!boost rij ') || msg === '!leave';

    if (isQueueCommand && !isFan) {
      console.log(`[NO FAN] ${display_name} probeerde !join/!boost/!leave zonder Heart Me`);
      return;
    }

    if (msg === '!join') {
      console.log(`!join ontvangen van ${display_name} [FAN]`);
      try { await addToQueue(userId.toString(), display_name); emitQueue(); }
      catch (e: any) { console.log('Join error:', e.message); }
    } else if (msg.startsWith('!boost rij ')) {
      const spots = parseInt(msg.split(' ')[2] || '0');
      if (spots >= 1 && spots <= 5) {
        console.log(`!boost rij ${spots} van ${display_name} [FAN]`);
        try { await boostQueue(userId.toString(), spots); emitQueue(); }
        catch (e: any) { console.log('Boost error:', e.message); }
      }
    } else if (msg === '!leave') {
      console.log(`!leave ontvangen van ${display_name} [FAN]`);
      try {
        const refund = await leaveQueue(userId.toString());
        if (refund > 0) console.log(`${display_name} kreeg ${refund} BP terug`);
        emitQueue();
      } catch (e: any) { console.log('Leave error:', e.message); }
    }
  }); // <--- SLUIT CHAT HANDLER

  // === GIFT ===
  tiktokLiveConnection.on('gift', async (data: any) => {
    const userIdRaw = data.userId || data.uniqueId || '0';
    const userId = BigInt(userIdRaw);
    const display_name = data.nickname || 'Onbekend';
    const giftName = (data.giftName || '').toLowerCase();

    if (giftName.includes('heart me')) {
      await activateFanStatus(userId, display_name);
      const { isFan, isVip } = await getUserData(userId, display_name);
      await addBP(userId, 0.5, 'GIFT', display_name, isFan, isVip);
      console.log(`Heart Me → FAN ACTIVATED VOOR 24 UUR (ID: ${userId})`);
      return;
    }

    const diamonds = data.diamondCount || 0;
    const giftBP = diamonds * 0.5;
    if (giftBP <= 0) return;

    const { isFan, isVip } = await getUserData(userId, display_name);
    await addBP(userId, giftBP, 'GIFT', display_name, isFan, isVip);
    console.log(`${data.giftName} (${diamonds} diamonds)`);
  });

  // === ROBUUSTE LIKE-SYSTEEM (GEBASEERD OP JOUW BINGO SCRIPT) ===
   tiktokLiveConnection.on('like', async (data: any) => {
    const userIdRaw = data.userId || data.uniqueId || '0';
    const userId = BigInt(userIdRaw);
    const userIdStr = userId.toString();
    const display_name = data.nickname || 'Onbekend';

    // DIT IS DE MAGIE: gebruik totalLikeCount als het bestaat!
    const realStreak = data.totalLikeCount ?? 0;
    const batchLikes = data.likeCount || 1;

    // Update cache
    nameCache.set(userIdStr, display_name);

    // Vorige streak uit pending (voor flush)
    const previousPending = pendingLikes.get(userIdStr) || 0;

    // Als TikTok totalLikeCount stuurt → gebruiken we die als bron van waarheid
    let newTotal: number;
    if (realStreak > 0) {
      newTotal = realStreak;
      console.log(`TOTAL STREAK: ${display_name} heeft ${realStreak} likes (batch: ${batchLikes})`);
    } else {
      newTotal = previousPending + batchLikes;
      console.log(`BATCH: ${display_name} +${batchLikes} likes → totaal ${newTotal}`);
    }

    // Bereken hoeveel BP we moeten geven
    const previousHundreds = Math.floor(previousPending / 100);
    const newHundreds = Math.floor(newTotal / 100);
    const bpToGive = newHundreds - previousHundreds;

    if (bpToGive > 0) {
      const { isFan, isVip } = await getUserData(userId, display_name);
      await addBP(userId, bpToGive, 'LIKE', display_name, isFan, isVip);
      console.log(`LIKE → +${bpToGive} BP voor ${display_name} (${newTotal} likes)`);
    }

    // Update pending voor flush
    pendingLikes.set(userIdStr, newTotal);
  });

  // Helper: haal display_name op (cache voor performance)
  const nameCache = new Map<string, string>();
  async function getDisplayNameFromId(userId: bigint): Promise<string | null> {
    const cached = nameCache.get(userId.toString());
    if (cached) return cached;
    const res = await pool.query('SELECT display_name FROM users WHERE tiktok_id = $1', [userId]);
    const name = res.rows[0]?.display_name || null;
    if (name) nameCache.set(userId.toString(), name);
    return name;
  }

  tiktokLiveConnection.on('like', async (data: any) => {
    const userIdRaw = data.userId || data.uniqueId || '0';
    const userId = BigInt(userIdRaw);
    const userIdStr = userId.toString();
    const display_name = data.nickname || 'Onbekend';
    const likeCount = data.likeCount || 1;

    // Update cache
    nameCache.set(userIdStr, display_name);

    console.log(`Likes ontvangen van ${display_name}: ${likeCount} (totaal pending: ${(pendingLikes.get(userIdStr) || 0) + likeCount})`);

    // Tel op
    const current = pendingLikes.get(userIdStr) || 0;
    const total = current + likeCount;
    pendingLikes.set(userIdStr, total);

    // Direct verwerken als threshold bereikt
    if (total >= LIKES_THRESHOLD) {
      const fullHundreds = Math.floor(total / 100);
      const { isFan, isVip } = await getUserData(userId, display_name);
      await addBP(userId, fullHundreds, 'LIKE', display_name, isFan, isVip);
      console.log(`DIRECT: ${total} likes → +${fullHundreds} BP voor ${display_name}`);
      pendingLikes.set(userIdStr, total % 100);
    }
  });

  // FOLLOW & SHARE (blijven zoals ze waren, maar met nameCache)
  tiktokLiveConnection.on('follow', async (data: any) => {
    const userIdRaw = data.userId || data.uniqueId || '0';
    const userId = BigInt(userIdRaw);
    const display_name = data.nickname || 'Onbekend';
    nameCache.set(userId.toString(), display_name);

    if (hasFollowed.has(userId.toString())) return;
    hasFollowed.add(userId.toString());

    const { isFan, isVip } = await getUserData(userId, display_name);
    await addBP(userId, 5, 'FOLLOW', display_name, isFan, isVip);
    console.log(`Follow van ${display_name}`);
  });

  tiktokLiveConnection.on('share', async (data: any) => {
    const userIdRaw = data.userId || data.uniqueId || '0';
    const userId = BigInt(userIdRaw);
    const display_name = data.nickname || 'Onbekend';
    nameCache.set(userId.toString(), display_name);

    const { isFan, isVip } = await getUserData(userId, display_name);
    await addBP(userId, 5, 'SHARE', display_name, isFan, isVip);
    console.log(`Share van ${display_name}`);
  });

  tiktokLiveConnection.on('connected', () => {
    console.log('Volledig verbonden met TikTok Live!');
  });
}


const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME || 'JOUW_TIKTOK_USERNAME';

initDB().then(async () => {
  server.listen(4000, () => {
    console.log('Backend draait op :4000');
    startTikTokLive(TIKTOK_USERNAME);
  });
});
