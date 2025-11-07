// backend/src/server.ts
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { WebcastPushConnection } from 'tiktok-live-connector';
import { initDB } from './db';
import pool from './db';
import { addToQueue, leaveQueue, getQueue } from './queue';
import cors from 'cors';
import dotenv from 'dotenv';
import { initGame, arenaJoin, arenaLeave, arenaClear, addBP, getArena } from './game';

dotenv.config();

const app = express();
app.use(cors());
const server = http.createServer(app);
export const io = new Server(server, { cors: { origin: '*' } });

initGame(io);

app.get('/queue', async (req, res) => {
  const queue = await getQueue();
  res.json(queue);
});

app.get('/arena', async (req, res) => {
  res.json(getArena());
});

io.on('connection', (socket) => {
  console.log('Dashboard connected:', socket.id);
  const { emitQueue } = require('./queue');
  emitQueue();
  const { emitArena } = require('./game');
  emitArena();
});

const ADMIN_ID = process.env.ADMIN_TIKTOK_ID?.trim();

async function connectWithRetry(username: string, retries = 6): Promise<WebcastPushConnection> {
  for (let i = 0; i < retries; i++) {
    try {
      const conn = new WebcastPushConnection(username);
      await conn.connect();

      // ROOM ID LOG DIRECT NA CONNECTIE
      const roomInfo = conn.getRoomInfo();
      const roomId = roomInfo?.roomId || 'ONBEKEND';
      console.info(`Verbonden met TikTok Live van @${username} (poging ${i + 1})`);
      console.info(`ROOM ID: ${roomId}`.padEnd(60, '='));

      return conn;
    } catch (err: any) {
      console.error(`Connectie mislukt (poging ${i + 1}/${retries}):`, err.message || err);
      if (i < retries - 1) await new Promise(r => setTimeout(r, 7000));
    }
  }
  throw new Error('Definitief geen verbinding');
}

async function getUserData(tiktok_id: bigint, display_name: string, username: string) {
  const usernameWithAt = '@' + username.toLowerCase();
  const query = `
    INSERT INTO users (tiktok_id, display_name, username, bp_total, is_fan, fan_expires_at, is_vip, vip_expires_at)
    VALUES ($1, $2, $3, 0, false, NULL, false, NULL)
    ON CONFLICT (tiktok_id) 
    DO UPDATE SET display_name = EXCLUDED.display_name, username = EXCLUDED.username
    RETURNING bp_total, is_fan, fan_expires_at, is_vip, vip_expires_at;
  `;
  const res = await pool.query(query, [tiktok_id, display_name, usernameWithAt]);
  const row = res.rows[0];
  const isFan = row.is_fan && row.fan_expires_at && new Date(row.fan_expires_at) > new Date();
  const isVip = row.is_vip && row.vip_expires_at && new Date(row.vip_expires_at) > new Date();
  return { isFan, isVip };
}

async function startTikTokLive(username: string) {
  const conn = await connectWithRetry(username);
  const pendingLikes = new Map<string, number>();
  const hasFollowed = new Set<string>();

  // === MULTI-GUEST EVENTS (2025) - 100% WERKENDE ===
  conn.on('liveRoomGuestEnter', (data: any) => {
    if (!data.user) return;
    const userId = data.user.userId?.toString() || data.userId?.toString();
    const display_name = data.user.nickname || data.nickname || 'Onbekend';
    const tikTokUsername = data.user.uniqueId || data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');

    console.log(`[BB JOIN] ${display_name} (@${tikTokUsername}) → MULTI-GUEST (liveRoomGuestEnter)`);
    arenaJoin(userId, display_name, tikTokUsername, 'guest');
  });

  conn.on('liveRoomGuestLeave', (data: any) => {
    const userId = data.user?.userId?.toString() || data.userId?.toString();
    if (!userId) return;
    const display_name = data.user?.nickname || data.nickname || 'Onbekend';
    console.log(`[BB LEAVE] ${display_name} → verlaat multi-guest`);
    arenaLeave(userId);
  });

  // === BACKUP: cohost via member event ===
  conn.on('member', async (data: any) => {
    if (data.isCoHost || data.role === 'cohost') {
      const userId = BigInt(data.userId || data.uniqueId || '0').toString();
      const display_name = data.nickname || 'Onbekend';
      const tikTokUsername = data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
      console.log(`[BB JOIN BACKUP] ${display_name} → cohost flag (member event)`);
      arenaJoin(userId, display_name, tikTokUsername, 'guest');
      await getUserData(BigInt(userId), display_name, tikTokUsername);
    }
  });

  conn.on('liveEnd', () => {
    console.log(`[BB END] Stream eindigt – arena wordt leeggemaakt`);
    arenaClear();
  });

  // === CHAT + ADMIN COMMANDS ===
  conn.on('chat', async (data: any) => {
    const rawComment = data.comment || '';
    const msg = rawComment.trim();
    const msgLower = msg.toLowerCase();
    if (!msg) return;

    const userId = BigInt(data.userId || data.uniqueId || '0');
    const display_name = data.nickname || 'Onbekend';
    const tikTokUsername = data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const isAdmin = userId.toString() === ADMIN_ID;

    console.log(`[CHAT] "${rawComment}" → "${msgLower}" (@${tikTokUsername})`);

    const { isFan, isVip } = await getUserData(userId, display_name, tikTokUsername);
    await addBP(userId, 1, 'CHAT', display_name, isFan, isVip);

    if (!isAdmin || !msgLower.startsWith('!adm ')) return;
    const args = msg.slice(5).trim().split(' ');
    const cmd = args[0].toLowerCase();
    const rawUsername = args[1];
    if (!rawUsername?.startsWith('@')) return;

    const targetRes = await pool.query(
      'SELECT tiktok_id, display_name FROM users WHERE LOWER(username) = LOWER($1)',
      [rawUsername]
    );

    if (!targetRes.rows[0]) {
      console.log(`[ADMIN] Gebruiker ${rawUsername} niet gevonden`);
      return;
    }

    const targetId = targetRes.rows[0].tiktok_id;
    const targetDisplay = targetRes.rows[0].display_name || rawUsername;

    if (cmd === 'geef' && args[2]) {
      const amount = parseFloat(args[2]);
      if (isNaN(amount) || amount <= 0) return;
      await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [amount, targetId]);
      console.log(`[ADMIN] +${amount} BP → ${rawUsername}`);
      return;
    }

    if (cmd === 'verw' && args[2]) {
      const amount = parseFloat(args[2]);
      if (isNaN(amount) || amount <= 0) return;
      await pool.query('UPDATE users SET bp_total = GREATEST(bp_total - $1, 0) WHERE tiktok_id = $2', [amount, targetId]);
      console.log(`[ADMIN] -${amount} BP → ${rawUsername}`);
      return;
    }

    if (cmd === 'voegrij') {
      await addToQueue(targetId.toString(), targetDisplay);
      const { emitQueue } = require('./queue');
      emitQueue();
      console.log(`[ADMIN] ${rawUsername} → wachtrij`);
      return;
    }

    if (cmd === 'verwrij') {
      const refund = await leaveQueue(targetId.toString());
      if (refund > 0) {
        const half = Math.floor(refund * 0.5);
        await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [half, targetId]);
        console.log(`[ADMIN] ${rawUsername} verwijderd → +${half} BP refund`);
      }
      const { emitQueue } = require('./queue');
      emitQueue();
      return;
    }

    if (cmd === 'geefvip') {
      await pool.query('UPDATE users SET is_vip = true, vip_expires_at = NOW() + INTERVAL \'30 days\' WHERE tiktok_id = $1', [targetId]);
      console.log(`[ADMIN] VIP 30 dagen → ${rawUsername}`);
      return;
    }

    if (cmd === 'verwvip') {
      await pool.query('UPDATE users SET is_vip = false, vip_expires_at = NULL WHERE tiktok_id = $1', [targetId]);
      console.log(`[ADMIN] VIP verwijderd → ${rawUsername}`);
      return;
    }
  });

  // === GIFT ===
  conn.on('gift', async (data: any) => {
    const userId = BigInt(data.userId || data.uniqueId || '0');
    const display_name = data.nickname || 'Onbekend';
    const tikTokUsername = data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const giftName = (data.giftName || '').toLowerCase();

    if (giftName.includes('heart me')) {
      await pool.query(
        `INSERT INTO users (tiktok_id, display_name, username, is_fan, fan_expires_at)
         VALUES ($1, $2, $3, true, NOW() + INTERVAL '24 hours')
         ON CONFLICT (tiktok_id) DO UPDATE SET is_fan = true, fan_expires_at = NOW() + INTERVAL '24 hours'`,
        [userId, display_name, '@' + tikTokUsername]
      );
      const { isFan, isVip } = await getUserData(userId, display_name, tikTokUsername);
      await addBP(userId, 0.5, 'GIFT', display_name, isFan, isVip);
      console.log(`Heart Me → FAN 24u (${display_name})`);
      return;
    }

    const diamonds = data.diamondCount || 0;
    const bp = diamonds * 0.5;
    if (bp <= 0) return;

    const { isFan, isVip } = await getUserData(userId, display_name, tikTokUsername);
    await addBP(userId, bp, 'GIFT', display_name, isFan, isVip);
    console.log(`${data.giftName} (${diamonds} diamonds) → +${bp} BP`);
  });

  // === LIKE (per 100) ===
  conn.on('like', async (data: any) => {
    const userId = BigInt(data.userId || data.uniqueId || '0');
    const display_name = data.nickname || 'Onbekend';
    const tikTokUsername = data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');

    const batch = data.likeCount || 1;
    const prev = pendingLikes.get(userId.toString()) || 0;
    const total = prev + batch;
    const bp = Math.floor(total / 100) - Math.floor(prev / 100);

    if (bp > 0) {
      const { isFan, isVip } = await getUserData(userId, display_name, tikTokUsername);
      await addBP(userId, bp, 'LIKE', display_name, isFan, isVip);
    }
    pendingLikes.set(userId.toString(), total);
  });

  // === FOLLOW & SHARE ===
  conn.on('follow', async (data: any) => {
    const userId = BigInt(data.userId || data.uniqueId || '0');
    if (hasFollowed.has(userId.toString())) return;
    hasFollowed.add(userId.toString());
    const display_name = data.nickname || 'Onbekend';
    const tikTokUsername = data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const { isFan, isVip } = await getUserData(userId, display_name, tikTokUsername);
    await addBP(userId, 5, 'FOLLOW', display_name, isFan, isVip);
  });

  conn.on('share', async (data: any) => {
    const userId = BigInt(data.userId || data.uniqueId || '0');
    const display_name = data.nickname || 'Onbekend';
    const tikTokUsername = data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const { isFan, isVip } = await getUserData(userId, display_name, tikTokUsername);
    await addBP(userId, 5, 'SHARE', display_name, isFan, isVip);
  });

  // === CONNECTED EVENT - ROOM ID NOG EENS VOOR 100% ZEKERHEID ===
  conn.on('connected', (state) => {
    const roomId = state.roomId || 'ONBEKEND';
    console.log('BATTLEBOX ENGINE 100% LIVE');
    console.log(`ROOM ID: ${roomId}`.padEnd(70, '='));
    console.log(`Titel: ${state.title || 'Geen titel'}`);
    console.log(`Status: ${state.status === 2 ? 'LIVE' : 'Niet live'}`);
    console.log(`Start: ${new Date(state.createTime * 1000).toLocaleString('nl-NL')}`);
    console.log('='.repeat(70));
  });
}

const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME || 'JOUW_TIKTOK_USERNAME';

initDB().then(async () => {
  server.listen(4000, () => {
    console.log('BATTLEBOX BACKEND GESTART OP POORT 4000');
    console.log('MULTI-GUEST 100% GEDETECTEERD – KLAAR VOOR DE OORLOG');
    console.log('='.repeat(70));
    startTikTokLive(TIKTOK_USERNAME);
  });
});
