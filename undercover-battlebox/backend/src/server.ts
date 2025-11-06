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

      // === ALLEEN ADMIN – WERKT NU OP USERNAME MET @ ===
    if (!isAdmin) return;

    if (!msgLower.startsWith('!adm ')) return;
    const args = msg.slice(5).trim().split(' ');
    const cmd = args[0].toLowerCase();

    // Haal de username met @ op (bijv. @dangol__)
    const rawUsername = args[1];
    if (!rawUsername?.startsWith('@')) return;
    const username = rawUsername.slice(1); // zonder @

    // Zoek exact op username (hoofdlettergevoelig zoals TikTok het stuurt)
    const targetRes = await pool.query(
      'SELECT tiktok_id, display_name FROM users WHERE username = $1',
      [rawUsername] // inclusief @
    );

    if (!targetRes.rows[0]) {
      console.log(`[ADMIN] Gebruiker ${rawUsername} niet gevonden in database`);
      return;
    }

    const targetId = targetRes.rows[0].tiktok_id;
    const targetDisplay = targetRes.rows[0].display_name || rawUsername;

    // !adm geef @dangol__ 500
    if (cmd === 'geef' && args[2]) {
      const amount = parseFloat(args[2]);
      if (isNaN(amount) || amount <= 0) return;
      await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [amount, targetId]);
      console.log(`[ADMIN] +${amount} BP gegeven aan ${rawUsername}`);
      return;
    }

    // !adm verw @dangol__ 200
    if (cmd === 'verw' && args[2]) {
      const amount = parseFloat(args[2]);
      if (isNaN(amount) || amount <= 0) return;
      await pool.query('UPDATE users SET bp_total = GREATEST(bp_total - $1, 0) WHERE tiktok_id = $2', [amount, targetId]);
      console.log(`[ADMIN] -${amount} BP afgetrokken van ${rawUsername}`);
      return;
    }

    // !adm voegrij @dangol__
    if (cmd === 'voegrij') {
      await addToQueue(targetId.toString(), targetDisplay);
      emitQueue();
      console.log(`[ADMIN] ${rawUsername} toegevoegd aan wachtrij (force)`);
      return;
    }

    // !adm verwrij @dangol__ → 50% refund
    if (cmd === 'verwrij') {
      const refund = await leaveQueue(targetId.toString());
      if (refund > 0) {
        const halfRefund = Math.floor(refund * 0.5);
        await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [halfRefund, targetId]);
        console.log(`[ADMIN] ${rawUsername} verwijderd uit rij → 50% refund: +${halfRefund} BP`);
      }
      emitQueue();
      return;
    }

    // !adm geefvip @dangol__ → VIP voor 30 dagen
    if (cmd === 'geefvip') {
      await pool.query(
        'UPDATE users SET is_vip = true, vip_expires_at = NOW() + INTERVAL \'30 days\' WHERE tiktok_id = $1',
        [targetId]
      );
      console.log(`[ADMIN] VIP gegeven aan ${rawUsername} (30 dagen)`);
      return;
    }

    // !adm verwvip @dangol__
    if (cmd === 'verwvip') {
      await pool.query('UPDATE users SET is_vip = false, vip_expires_at = NULL WHERE tiktok_id = $1', [targetId]);
      console.log(`[ADMIN] VIP verwijderd van ${rawUsername}`);
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
