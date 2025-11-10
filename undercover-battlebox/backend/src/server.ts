// src/server.ts — BATTLEBOX 5-ENGINE – FINAL ONSTERFELIJK – 11 NOV 2025 00:35 CET
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { initDB } from './db';
import pool from './db';
import cors from 'cors';
import dotenv from 'dotenv';

// ENGINES
import { startConnection } from './engines/1-connection';
import { getOrUpdateUser } from './engines/2-user-engine';
import { initGiftEngine } from './engines/3-gift-engine';
import { addBP } from './engines/4-points-engine';
import { 
  initGame, 
  arenaJoin, 
  arenaLeave, 
  arenaClear, 
  getArena, 
  emitArena 
} from './engines/5-game-engine';
import { addToQueue, getQueue } from './queue';

dotenv.config();

// === CHECK .env ===
if (!process.env.TIKTOK_USERNAME) {
  console.error('TIKTOK_USERNAME ontbreekt in .env!');
  process.exit(1);
}

// === EXPRESS + SOCKET.IO ===
const app = express();
app.use(cors());
const server = http.createServer(app);
export const io = new Server(server, { cors: { origin: '*' } });

// REST API
app.get('/queue', async (req, res) => res.json(await getQueue()));
app.get('/arena', async (req, res) => res.json(getArena()));

// SOCKET CONNECTIE
io.on('connection', (socket) => {
  console.log('Dashboard connected:', socket.id);
  emitQueue();
  emitArena();
});

export function emitQueue() {
  io.emit('queue:update', getQueue());
}

// GLOBALS
const ADMIN_ID = process.env.ADMIN_TIKTOK_ID?.trim();
let conn: any = null;

// === START ALLES ===
initDB().then(async () => {
  server.listen(4000, () => {
    console.log('BATTLEBOX 5-ENGINE BACKEND LIVE → http://localhost:4000');
    console.log('='.repeat(80));
  });

  initGame();

  // VERBIND MET TIKTOK LIVE
  const { conn: tikTokConn } = await startConnection(
    process.env.TIKTOK_USERNAME!,
    () => {}
  );

  conn = tikTokConn;

  // START GIFT ENGINE – ALLES VIA .env
  initGiftEngine(conn);

  // CHAT + ADMIN
  conn.on('chat', async (data: any) => {
    const msg = (data.comment || '').trim();
    if (!msg) return;

    const userId = BigInt(data.userId || '0');
    const user = await getOrUpdateUser(userId.toString(), data.nickname, data.uniqueId);

    console.log(`[CHAT] ${user.display_name}: ${msg}`);
    await addBP(userId, 1, 'CHAT', user.display_name);

    if (userId.toString() === ADMIN_ID && msg.toLowerCase().startsWith('!adm voegrij @')) {
      const target = msg.split('@')[1]?.split(' ')[0];
      if (target) {
        const res = await pool.query('SELECT tiktok_id FROM users WHERE username ILIKE $1', [`%@${target}`]);
        if (res.rows[0]) {
          await addToQueue(res.rows[0].tiktok_id, target);
          emitQueue();
          console.log(`[ADMIN] ${target} toegevoegd aan queue`);
        }
      }
    }
  });

  // LIKE / FOLLOW / SHARE
  const pendingLikes = new Map<string, number>();
  const hasFollowed = new Set<string>();

  conn.on('like', async (data: any) => {
    const userId = (data.userId || '0').toString();
    if (userId === '0') return;
    const prev = pendingLikes.get(userId) || 0;
    const total = prev + (data.likeCount || 1);
    const bp = Math.floor(total / 100) - Math.floor(prev / 100);
    if (bp > 0) {
      const user = await getOrUpdateUser(userId, data.nickname, data.uniqueId);
      await addBP(BigInt(userId), bp, 'LIKE', user.display_name);
    }
    pendingLikes.set(userId, total);
  });

  conn.on('follow', async (data: any) => {
    const userId = (data.userId || '0').toString();
    if (userId === '0' || hasFollowed.has(userId)) return;
    hasFollowed.add(userId);
    const user = await getOrUpdateUser(userId, data.nickname, data.uniqueId);
    await addBP(BigInt(userId), 5, 'FOLLOW', user.display_name);
  });

  conn.on('share', async (data: any) => {
    const userId = (data.userId || '0').toString();
    if (userId === '0') return;
    const user = await getOrUpdateUser(userId, data.nickname, data.uniqueId);
    await addBP(BigInt(userId), 5, 'SHARE', user.display_name);
  });

  // GUEST → ARENA
  conn.on('liveRoomGuestEnter', async (data: any) => {
    const userId = (data.user?.userId || '0').toString();
    if (userId === '0') return;
    const user = await getOrUpdateUser(userId, data.user?.nickname, data.user?.uniqueId);
    arenaJoin(userId, user.display_name, user.username, 'guest');
    console.log(`[JOIN] ${user.display_name} → ARENA`);
  });

  conn.on('liveRoomGuestLeave', (data: any) => {
    const userId = (data.user?.userId || '0').toString();
    if (userId === '0') return;
    arenaLeave(userId);
  });

  conn.on('liveEnd', () => {
    console.log('[LIVE END] Alles gereset');
    arenaClear();
  });
});
