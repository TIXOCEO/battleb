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
    INSERT INTO users (tiktok_id, display_name, username, bp_total, is_fan, fan_expires_at, is_vip, vip_expires_at)
    VALUES ($1, $2, $2, 0, false, NULL, false, NULL)
    ON CONFLICT (tiktok_id) 
    DO UPDATE SET display_name = EXCLUDED.display_name, username = EXCLUDED.display_name
    RETURNING bp_total, is_fan, fan_expires_at, is_vip, vip_expires_at;
  `;

  const res = await pool.query(query, [tiktok_id, display_name]);
  const row = res.rows[0];
  const isFan = row.is_fan && row.fan_expires_at && new Date(row.fan_expires_at) > new Date();
  const isVip = row.is_vip && row.vip_expires_at && new Date(row.vip_expires_at) > new Date();

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

  const pendingLikes = new Map<string, number>();
  const hasFollowed = new Set<string>();
  const nameCache = new Map<string, string>();

  // === CHAT + ADMIN COMMANDOS ===
  tiktokLiveConnection.on('chat', async (data: any) => {
    const rawComment = data.comment || '';
    const msg = rawComment.trim();
    const msgLower = msg.toLowerCase();
    if (!msg) return;

    const userIdRaw = data.userId || data.uniqueId || '0';
    const userId = BigInt(userIdRaw);
    const display_name = data.nickname || 'Onbekend';
    const isAdmin = userId.toString() === ADMIN_ID;

    console.log(`[CHAT] Raw: "${rawComment}" → Parsed: "${msgLower}" (user: ${display_name}, ID: ${userId})`);

    const { isFan, isVip } = await getUserData(userId, display_name);
    await addBP(userId, 1, 'CHAT', display_name, isFan, isVip);

    // === ALLEEN ADMIN ===
    if (!isAdmin) return;

    if (!msgLower.startsWith('!adm ')) return;
    const args = msg.slice(5).trim().split(' ');
    const cmd = args[0].toLowerCase();

    // !adm geef @user aantal
    if (cmd === 'geef' && args[1]?.startsWith('@') && args[2]) {
      const targetName = args[1].slice(1);
      const amount = parseFloat(args[2]);
      if (isNaN(amount)) return;
      const targetRes = await pool.query('SELECT tiktok_id FROM users WHERE display_name ILIKE $1', [`%${targetName}%`]);
      if (targetRes.rows[0]) {
        await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [amount, targetRes.rows[0].tiktok_id]);
        console.log(`[ADMIN] +${amount} BP gegeven aan @${targetName}`);
      }
      return;
    }

    // !adm verw @user aantal
    if (cmd === 'verw' && args[1]?.startsWith('@') && args[2]) {
      const targetName = args[1].slice(1);
      const amount = parseFloat(args[2]);
      if (isNaN(amount)) return;
      const targetRes = await pool.query('SELECT tiktok_id FROM users WHERE display_name ILIKE $1', [`%${targetName}%`]);
      if (targetRes.rows[0]) {
        await pool.query('UPDATE users SET bp_total = GREATEST(bp_total - $1, 0) WHERE tiktok_id = $2', [amount, targetRes.rows[0].tiktok_id]);
        console.log(`[ADMIN] -${amount} BP afgetrokken van @${targetName}`);
      }
      return;
    }

    // !adm voegrij @user
    if (cmd === 'voegrij' && args[1]?.startsWith('@')) {
      const targetName = args[1].slice(1);
      const targetRes = await pool.query('SELECT tiktok_id FROM users WHERE display_name ILIKE $1', [`%${targetName}%`]);
      if (targetRes.rows[0]) {
        await addToQueue(targetRes.rows[0].tiktok_id.toString(), targetName);
        emitQueue();
        console.log(`[ADMIN] @${targetName} toegevoegd aan wachtrij (force)`);
      }
      return;
    }

    // !adm verwrij @user → 50% refund
    if (cmd === 'verwrij' && args[1]?.startsWith('@')) {
      const targetName = args[1].slice(1);
      const targetRes = await pool.query('SELECT tiktok_id FROM users WHERE display_name ILIKE $1', [`%${targetName}%`]);
      if (targetRes.rows[0]) {
        const refund = await leaveQueue(targetRes.rows[0].tiktok_id.toString());
        if (refund > 0) {
          const halfRefund = Math.floor(refund * 0.5);
          await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [halfRefund, targetRes.rows[0].tiktok_id]);
          console.log(`[ADMIN] @${targetName} verwijderd uit rij → 50% refund: +${halfRefund} BP`);
        }
        emitQueue();
      }
      return;
    }

    // !adm geefvip @user → VIP voor 30 dagen
    if (cmd === 'geefvip' && args[1]?.startsWith('@')) {
      const targetName = args[1].slice(1);
      const targetRes = await pool.query('SELECT tiktok_id FROM users WHERE display_name ILIKE $1', [`%${targetName}%`]);
      if (targetRes.rows[0]) {
        await pool.query('UPDATE users SET is_vip = true, vip_expires_at = NOW() + INTERVAL \'30 days\' WHERE tiktok_id = $1', [targetRes.rows[0].tiktok_id]);
        console.log(`[ADMIN] VIP gegeven aan @${targetName} (30 dagen)`);
      }
      return;
    }

    // !adm verwvip @user
    if (cmd === 'verwvip' && args[1]?.startsWith('@')) {
      const targetName = args[1].slice(1);
      const targetRes = await pool.query('SELECT tiktok_id FROM users WHERE display_name ILIKE $1', [`%${targetName}%`]);
      if (targetRes.rows[0]) {
        await pool.query('UPDATE users SET is_vip = false, vip_expires_at = NULL WHERE tiktok_id = $1', [targetRes.rows[0].tiktok_id]);
        console.log(`[ADMIN] VIP verwijderd van @${targetName}`);
      }
      return;
    }
  });

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

  // === LIKE – ALLEEN EIGEN LIKES DEZE SESSIE ===
  tiktokLiveConnection.on('like', async (data: any) => {
    const userIdRaw = data.userId || data.uniqueId || '0';
    const userId = BigInt(userIdRaw);
    const userIdStr = userId.toString();
    const display_name = data.nickname || 'Onbekend';

    nameCache.set(userIdStr, display_name);

    const batchLikes = data.likeCount || 1;
    const previousStreak = pendingLikes.get(userIdStr) || 0;
    const newStreak = previousStreak + batchLikes;

    const previousHundreds = Math.floor(previousStreak / 100);
    const newHundreds = Math.floor(newStreak / 100);
    const bpToGive = newHundreds - previousHundreds;

    if (bpToGive > 0) {
      const { isFan, isVip } = await getUserData(userId, display_name);
      await addBP(userId, bpToGive, 'LIKE', display_name, isFan, isVip);
      console.log(`LIKE → +${bpToGive} BP voor ${display_name} (${newStreak} eigen likes deze sessie)`);
    }

    console.log(`LIKES: ${display_name} +${batchLikes} → ${newStreak} (eigen sessie)`);
    pendingLikes.set(userIdStr, newStreak);
  });

  // === FOLLOW & SHARE ===
  tiktokLiveConnection.on('follow', async (data: any) => {
    const userIdRaw = data.userId || data.uniqueId || '0';
    const userId = BigInt(userIdRaw);
    const userIdStr = userId.toString();
    const display_name = data.nickname || 'Onbekend';
    nameCache.set(userIdStr, display_name);

    if (hasFollowed.has(userIdStr)) return;
    hasFollowed.add(userIdStr);

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
