// src/server.ts — 100% CORRECT, 5-ENGINE, ALLES WERKT, NOVEMBER 2025
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { WebcastPushConnection } from 'tiktok-live-connector';
import { initDB } from './db';
import pool from './db';
import cors from 'cors';
import dotenv from 'dotenv';

// ── ENGINES ─────────────────────────────────────────────────────
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
  getWinner,
  startRound,
  emitArena,
  arena 
} from './engines/5-game-engine';
import { addToQueue, leaveQueue, getQueue, emitQueue } from './queue';

dotenv.config();

const app = express();
app.use(cors());
const server = http.createServer(app);
export const io = new Server(server, { cors: { origin: '*' } });

// ── REST ENDPOINTS ─────────────────────────────────────────────
app.get('/queue', async (req, res) => res.json(await getQueue()));
app.get('/arena', async (req, res) => res.json(getArena()));

// ── SOCKET CONNECT ─────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Dashboard connected:', socket.id);
  emitQueue();
  emitArena();
});

// ── GLOBALS ───────────────────────────────────────────────────
const ADMIN_ID = process.env.ADMIN_TIKTOK_ID?.trim();
let hostId = '';
let conn: any = null;

// ── START BACKEND ─────────────────────────────────────────────
initDB().then(async () => {
  server.listen(4000, () => {
    console.log('BATTLEBOX 5-ENGINE BACKEND LIVE → http://localhost:4000');
    console.log('='.repeat(80));
  });

  // INIT GAME ENGINE
  initGame();

  // START TIKTOK CONNECTION
  const result = await startConnection(process.env.TIKTOK_USERNAME!, async (state) => {
    hostId = state.hostId || state.user?.userId || '';
    const hostNickname = state.user?.nickname || 'Host';
    const hostUniqueId = (state.user?.uniqueId || 'host').replace('@', '');

    await getOrUpdateUser(hostId, hostNickname, hostUniqueId);

    console.log('HOST PERFECT HERKEND');
    console.log(`${hostNickname} (@${hostUniqueId}) [ID: ${hostId}]`);
    console.log('='.repeat(80));

    // START GIFT ENGINE
    initGiftEngine(conn, {
      id: hostId,
      name: hostNickname,
      username: hostUniqueId
    });

    // AUTO-START EERSTE RONDE
    setTimeout(() => {
      console.log('\nAUTOMATISCHE START: KWARTFINALE OVER 15 SECONDEN...');
      setTimeout(() => startRound('quarter'), 15000);
    }, 2000);
  });

  conn = result.conn;

  // ── CHAT + ADMIN COMMANDS ───────────────────────────────────
  conn.on('chat', async (data: any) => {
    const msg = (data.comment || '').trim();
    if (!msg) return;

    const userId = BigInt(data.userId || '0');
    const user = await getOrUpdateUser(userId.toString(), data.nickname, data.uniqueId);

    console.log(`[CHAT] ${user.display_name}: ${msg}`);

    // BP VOOR CHAT
    await addBP(userId, 1, 'CHAT', user.display_name);

    // ADMIN COMMANDS
    if (userId.toString() === ADMIN_ID && msg.toLowerCase().startsWith('!adm ')) {
      const args = msg.slice(5).trim().split(' ');
      const cmd = args[0].toLowerCase();

      if (cmd === 'voegrij' && args[1]?.startsWith('@')) {
        const target = args[1].slice(1);
        const res = await pool.query('SELECT tiktok_id FROM users WHERE username ILIKE $1', [`%@${target}`]);
        if (res.rows[0]) {
          await addToQueue(res.rows[0].tiktok_id, target);
          emitQueue();
          console.log(`[ADMIN] ${target} toegevoegd aan queue`);
        }
      }

      if (cmd === 'start' && args[1]) {
        startRound(args[1] as 'quarter' | 'semi' | 'finale');
        console.log(`[ADMIN] Ronde gestart: ${args[1]}`);
      }
    }
  });

  // ── LIKE / FOLLOW / SHARE → BP ─────────────────────────────
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

  // ── GUEST ENTER/LEAVE → ARENA ─────────────────────────────
  conn.on('liveRoomGuestEnter', async (data: any) => {
    const userId = (data.user?.userId || '0').toString();
    if (userId === '0') return;
    const user = await getOrUpdateUser(userId, data.user?.nickname, data.user?.uniqueId);
    arenaJoin(userId, user.display_name, user.username, 'guest');
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
