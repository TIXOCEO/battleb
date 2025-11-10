// src/server.ts — SCHOON, MODULAIR, ONVERWOESTBAAR
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { WebcastPushConnection } from 'tiktok-live-connector';
import { initDB } from './db';
import pool from './db';
import cors from 'cors';
import dotenv from 'dotenv';

// ── ENGINES ─────────────────────────────────────
import { startConnection } from './engines/1-connection';
import { getOrUpdateUser } from './engines/2-user-engine';
import { initGiftEngine } from './engines/3-gift-engine';
import { addBP } from './engines/4-points-engine';
import { initGame, arenaJoin, arenaLeave, arenaClear, getArena, arena } from './engines/5-game-engine';
import { addToQueue, getQueue, emitQueue } from './queue';

dotenv.config();

const app = express();
app.use(cors());
const server = http.createServer(app);
export const io = new Server(server, { cors: { origin: '*' } });

// REST
app.get('/queue', async (req, res) => res.json(await getQueue()));
app.get('/arena', async (req, res) => res.json(getArena()));

// SOCKET
io.on('connection', (socket) => {
  console.log('Dashboard connected:', socket.id);
  emitQueue();
  io.emit('arena:update', getArena());
});

// GLOBALS
const ADMIN_ID = process.env.ADMIN_TIKTOK_ID?.trim();
let hostId = '';

initDB().then(async () => {
  server.listen(4000, () => {
    console.log('BATTLEBOX 5-ENGINE BACKEND LIVE → http://localhost:4000');
    console.log('='.repeat(80));
  });

  initGame(io);

  const { conn } = await startConnection(process.env.TIKTOK_USERNAME!, async (state) => {
    hostId = state.hostId || state.user?.userId || '';
    const hostNickname = state.user?.nickname || 'Host';
    const hostUniqueId = state.user?.uniqueId || 'host';

    await getOrUpdateUser(hostId, hostNickname, hostUniqueId);

    console.log('HOST PERFECT HERKEND');
    console.log(`→ ${hostNickname} (@${hostUniqueId}) [ID: ${hostId}]`);
    console.log('='.repeat(80));

    // DIT IS DE ENIGE PLEK WAAR WE DE GIFT ENGINE STARTEN
    initGiftEngine(conn, {
      id: hostId,
      name: hostNickname,
      username: hostUniqueId
    });

    // Auto-start ronde na 10s
    setTimeout(() => {
      console.log('\nEERSTE RONDE START OVER 10 SECONDEN...');
    }, 2000);
  });

  // GUEST JOIN/LEAVE → ARENA
  conn.on('liveRoomGuestEnter', async (data: any) => {
    const userId = (data.user?.userId || '0').toString();
    if (userId === '0') return;
    const user = await getOrUpdateUser(userId, data.user?.nickname, data.user?.uniqueId);
    arenaJoin(userId, user.display_name, user.username, 'fighter');
  });

  conn.on('liveRoomGuestLeave', (data: any) => {
    const userId = (data.user?.userId || '0').toString();
    if (userId === '0') return;
    arenaLeave(userId);
  });

  conn.on('liveEnd', () => {
    console.log('[LIVE END] Arena geleegd');
    arenaClear();
  });
});
