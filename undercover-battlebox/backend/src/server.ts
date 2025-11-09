// backend/src/server.ts
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { WebcastPushConnection } from 'tiktok-live-connector';
import { initDB } from './db';
import pool from './db';
import cors from 'cors';
import dotenv from 'dotenv';

// ── ENGINES ─────────────────────────────────────────────────────────────────────
import { startConnection } from './engines/1-connection';
import { getOrUpdateUser } from './engines/2-user-engine';
import { initGiftEngine } from './engines/3-gift-engine';
import { addBP } from './engines/4-points-engine';
import { initGame, startRound, emitArena, getArena } from './engines/5-game-engine';
import { addToQueue, leaveQueue, getQueue, emitQueue } from './queue';

dotenv.config();

const app = express();
app.use(cors());
const server = http.createServer(app);
export const io = new Server(server, { cors: { origin: '*' } });

// ── REST ENDPOINTS ─────────────────────────────────────────────────────────────
app.get('/queue', async (req, res) => {
  const queue = await getQueue();
  res.json(queue);
});

app.get('/arena', async (req, res) => {
  res.json(getArena());
});

// ── SOCKET.IO CONNECTION ───────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Dashboard connected:', socket.id);
  emitQueue();
  emitArena();
});

// ── GLOBALE VARIABELEN ─────────────────────────────────────────────────────────
const ADMIN_ID = process.env.ADMIN_TIKTOK_ID?.trim();
let hostId = '';

// ── START ALLE ENGINES ─────────────────────────────────────────────────────────
initDB().then(async () => {
  server.listen(4000, () => {
    console.log('BATTLEBOX 5-ENGINE BACKEND LIVE → http://localhost:4000');
    console.log('='.repeat(80));
  });

  // 1. Start game engine (arena + timer)
  initGame();

  // 2. Start TikTok Live connectie
  const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME?.trim();
  if (!TIKTOK_USERNAME) {
    console.error('TIKTOK_USERNAME niet ingesteld!');
    process.exit(1);
  }

  const { conn } = await startConnection(TIKTOK_USERNAME, async (state) => {
    hostId = state.hostId || state.userId || state.user?.userId || '';
    if (!hostId) {
      console.error('HOST ID NIET GEVONDEN!');
      return;
    }

    const hostNickname = state.user?.nickname || state.nickname || 'Host';
    const hostUniqueId = state.user?.uniqueId || state.uniqueId || 'host';

    const hostUser = await getOrUpdateUser(hostId, hostNickname, hostUniqueId);

    console.log('='.repeat(80));
    console.log('BATTLEBOX LIVE – HOST PERFECT HERKEND');
    console.log(`Host: ${hostUser.display_name} (@${hostUser.username}) [ID: ${hostId}]`);
    console.log('='.repeat(80));

    // 3. Start gift engine met correcte host info
    initGiftEngine(conn, {
      id: hostId,
      name: hostUser.display_name,
      username: hostUser.username
    });

    // 4. Start eerste ronde na 15 seconden (voor testing)
    setTimeout(() => {
      console.log('\nAUTOMATISCHE START: EERSTE RONDE OVER 15 SECONDEN...');
      setTimeout(() => {
        startRound('quarter');
      }, 15000);
    }, 2000);
  });

  // ── CHAT + ADMIN COMMANDS ───────────────────────────────────────────────────
  conn.on('chat', async (data: any) => {
    const rawComment = data.comment || '';
    const msg = rawComment.trim();
    if (!msg) return;

    const userId = BigInt(data.userId || data.uniqueId || '0');
    const user = await getOrUpdateUser(userId.toString(), data.nickname, data.uniqueId);

    console.log(`[CHAT] ${user.display_name}: ${rawComment}`);

    // BP voor chat
    const { rows } = await pool.query(
      'SELECT is_fan, fan_expires_at, is_vip, vip_expires_at FROM users WHERE tiktok_id = $1',
      [userId]
    );
    const row = rows[0] || {};
    const isFan = row.is_fan && row.fan_expires_at && new Date(row.fan_expires_at) > new Date();
    const isVip = row.is_vip && row.vip_expires_at && new Date(row.vip_expires_at) > new Date();

    await addBP(userId, 1, 'CHAT', user.display_name);

    // Admin commands
    const msgLower = msg.toLowerCase();
    const isAdmin = userId.toString() === ADMIN1500;
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
      console.log(`[ADMIN] Niet gevonden: ${rawUsername}`);
      return;
    }

    const targetId = targetRes.rows[0].tiktok_id.toString();
    const targetDisplay = targetRes.rows[0].display_name || rawUsername;

    switch (cmd) {
      case 'voegrij':
        await addToQueue(targetId, targetDisplay);
        emitQueue();
        console.log(`[ADMIN] ${rawUsername} → wachtrij`);
        break;
      case 'verwrij':
        const refund = await leaveQueue(targetId);
        if (refund > 0) {
          const half = Math.floor(refund * 0.5);
          await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [half, BigInt(targetId)]);
          console.log(`[ADMIN] ${rawUsername} verwijderd → +${half} BP refund`);
        }
        emitQueue();
        break;
      case 'start':
        startRound(args[1] || 'quarter');
        console.log(`[ADMIN] Ronde gestart: ${args[1] || 'quarter'}`);
        break;
    }
  });

  // ── LIKE, FOLLOW, SHARE (BP) ───────────────────────────────────────────────
  const pendingLikes = new Map<string, number>();
  const hasFollowed = new Set<string>();

  conn.on('like', async (data: any) => {
    const userId = (data.userId || data.uniqueId || '0').toString();
    if (userId === '0') return;

    const user = await getOrUpdateUser(userId, data.nickname, data.uniqueId);
    const prev = pendingLikes.get(userId) || 0;
    const total = prev + (data.likeCount || 1);
    const bp = Math.floor(total / 100) - Math.floor(prev / 100);
    if (bp > 0) {
      await addBP(BigInt(userId), bp, 'LIKE', user.display_name);
    }
    pendingLikes.set(userId, total);
  });

  conn.on('follow', async (data: any) => {
    const userId = (data.userId || data.uniqueId || '0').toString();
    if (userId === '0' || hasFollowed.has(userId)) return;
    hasFollowed.add(userId);

    const user = await getOrUpdateUser(userId, data.nickname, data.uniqueId);
    await addBP(BigInt(userId), 5, 'FOLLOW', user.display_name);
  });

  conn.on('share', async (data: any) => {
    const userId = (data.userId || data.uniqueId || '0').toString();
    if (userId === '0') return;

    const user = await getOrUpdateUser(userId, data.nickname, data.uniqueId);
    await addBP(BigInt(userId), 5, 'SHARE', user.display_name);
  });

  // ── GUEST ENTER/LEAVE → ARENA ───────────────────────────────────────────────
  conn.on('liveRoomGuestEnter', async (data: any) => {
    const userId = (data.user?.userId || data.userId || '0').toString();
    if (userId === '0') return;

    const user = await getOrUpdateUser(userId, data.user?.nickname, data.user?.uniqueId);
    arenaJoin(userId, user.display_name, user.username, 'guest');
    console.log(`[GUEST JOIN] ${user.display_name} (@${user.username}) → ARENA`);
  });

  conn.on('liveRoomGuestLeave', (data: any) => {
    const userId = (data.user?.userId || data.userId || '0').toString();
    if (userId === '0') return;
    arenaLeave(userId);
  });

  conn.on('liveEnd', () => {
    console.log('[LIVE END] Arena geleegd');
    arenaClear();
  });
});
