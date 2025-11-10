// src/server.ts — FINAL VERSION – GIFTS ZIJN TERUG + ALLES PERFECT
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { WebcastPushConnection } from 'tiktok-live-connector';
import { initDB } from './db';
import pool from './db';
import cors from 'cors';
import dotenv from 'dotenv';

// ── JOUW BESTAANDE MODULES ─────────────────────────────────────
import { addToQueue, leaveQueue, getQueue } from './queue';
import { initGame, arenaJoin, arenaLeave, arenaClear, addBP, getArena, arena } from './game'; // ← arena toegevoegd!

dotenv.config();

const app = express();
app.use(cors());
const server = http.createServer(app);
export const io = new Server(server, { cors: { origin: '*' } });

// ── INIT GAME (voor socket.io) ─────────────────────────────────
initGame(io);

// ── REST ENDPOINTS ─────────────────────────────────────────────
app.get('/queue', async (req, res) => res.json(await getQueue()));
app.get('/arena', async (req, res) => res.json(getArena()));

// ── SOCKET CONNECT ─────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Dashboard connected:', socket.id);
  socket.emit('arena:update', getArena());
  socket.emit('arena:count', getArena().length);
});

// ── GLOBALS ───────────────────────────────────────────────────
const ADMIN_ID = process.env.ADMIN_TIKTOK_ID?.trim();
let HOST_DISPLAY_NAME = 'Host';
let HOST_USERNAME = 'host';
let hostId = '';

// ── USER HELPERS ───────────────────────────────────────────────
async function getOrUpdateUser(
  tiktok_id: string,
  nickname?: string,
  uniqueId?: string
): Promise<{ id: string; display_name: string; username: string }> {
  if (!tiktok_id || tiktok_id === '??') {
    return { id: '??', display_name: 'Onbekend', username: 'onbekend' };
  }

  const id = BigInt(tiktok_id);
  const { rows } = await pool.query(
    'SELECT display_name, username FROM users WHERE tiktok_id = $1',
    [id]
  );

  if (rows[0]) {
    const currentName = rows[0].display_name || rows[0].username;
    const currentUsername = rows[0].username;

    if (nickname && nickname !== 'Onbekend' && nickname !== currentName) {
      const cleanUsername = (uniqueId || nickname.toLowerCase().replace(/[^a-z0-9_]/g, '')).trim();
      const finalUsername = cleanUsername.startsWith('@') ? cleanUsername : '@' + cleanUsername;

      await pool.query(
        'UPDATE users SET display_name = $1, username = $2 WHERE tiktok_id = $3',
        [nickname, finalUsername, id]
      );
      return { id: tiktok_id, display_name: nickname, username: cleanUsername };
    }
    return { id: tiktok_id, display_name: currentName, username: currentUsername.replace('@', '') };
  }

  const display_name = nickname || `Onbekend#${tiktok_id.slice(-5)}`;
  const rawUsername = (uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '')).trim();
  const finalUsername = rawUsername.startsWith('@') ? rawUsername : '@' + rawUsername;

  await pool.query(
    'INSERT INTO users (tiktok_id, display_name, username, bp_total, diamonds_total) VALUES ($1, $2, $3, 0, 0) ON CONFLICT (tiktok_id) DO NOTHING',
    [id, display_name, finalUsername]
  );

  return { id: tiktok_id, display_name, username: rawUsername };
}

// ── START TIKTOK LIVE ─────────────────────────────────────────
async function startTikTokLive(username: string) {
  const conn = new WebcastPushConnection(username);
  const pendingLikes = new Map<string, number>();
  const hasFollowed = new Set<string>();

  // Connectie met retry
  for (let i = 0; i < 6; i++) {
    try {
      await conn.connect();
      console.info(`Verbonden met @${username}`);
      break;
    } catch (err: any) {
      console.error(`Poging ${i + 1} mislukt:`, err.message);
      if (i === 5) process.exit(1);
      await new Promise(r => setTimeout(r, 7000));
    }
  }

  conn.on('connected', async (state) => {
    hostId = state.hostId || state.user?.userId || '';
    HOST_DISPLAY_NAME = state.user?.nickname || 'Host';
    HOST_USERNAME = (state.user?.uniqueId || 'host').replace('@', '');

    console.log('='.repeat(80));
    console.log('BATTLEBOX LIVE – HOST PERFECT HERKEND');
    console.log(`Host: ${HOST_DISPLAY_NAME} (@${HOST_USERNAME}) [ID: ${hostId}]`);
    console.log('='.repeat(80));
  });

  // ── GIFT → DIAMONDS + BP (20%) ───────────────────────────────
  conn.on('gift', async (data: any) => {
    try {
      const senderId = (data.user?.userId || data.sender?.userId || '??').toString();
      const receiverId = (data.receiverUserId || data.toUserId || hostId || '??').toString();
      if (senderId === '??') return;

      const diamonds = data.diamondCount || 0;
      if (diamonds === 0) return;

      const giftName = data.giftName || 'Onbekend';
      const isToHost = receiverId === hostId;

      const sender = await getOrUpdateUser(senderId, data.user?.nickname, data.user?.uniqueId);
      const receiverName = isToHost ? HOST_DISPLAY_NAME : 'speler';

      console.log('\n[GIFT] – PERFECT');
      console.log(`   Van: ${sender.display_name} (@${sender.username})`);
      console.log(`   Aan: ${receiverName} ${isToHost ? '(HOST)' : ''}`);
      console.log(`   Gift: ${giftName} (${diamonds} diamonds)`);

      // DIAMONDS (spelpunten)
      await pool.query(
        `UPDATE users 
         SET diamonds_total = diamonds_total + $1,
             diamonds_stream = diamonds_stream + $1,
             diamonds_current_round = diamonds_current_round + $1
         WHERE tiktok_id = $2`,
        [diamonds, BigInt(senderId)]
      );

      // BP = 20% van diamonds
      const bp = diamonds * 0.2;
      const isFan = giftName.toLowerCase().includes('heart me');
      await addBP(BigInt(senderId), bp, 'GIFT', sender.display_name, isFan, false);

      // ALS IN ARENA → LIVE UPDATE
      if (arena.has(senderId)) {
        io.emit('arena:update', getArena());
      }

      console.log(`[BP +${bp.toFixed(1)}] → ${sender.display_name}`);
      console.log('='.repeat(80));
    } catch (err: any) {
      console.error('[GIFT FOUT]', err.message);
    }
  });

  // ── CHAT + ADMIN COMMANDS ───────────────────────────────────
  conn.on('chat', async (data: any) => {
    const msg = (data.comment || '').trim();
    if (!msg) return;

    const userId = BigInt(data.userId || '0');
    const user = await getOrUpdateUser(userId.toString(), data.nickname, data.uniqueId);

    console.log(`[CHAT] ${user.display_name}: ${msg}`);

    await addBP(userId, 1, 'CHAT', user.display_name, false, false);

    if (userId.toString() === ADMIN_ID && msg.toLowerCase().startsWith('!adm ')) {
      const args = msg.slice(5).trim().split(' ');
      const cmd = args[0].toLowerCase();

      if (cmd === 'start') {
        console.log('[ADMIN] Ronde starten commando ontvangen');
      }
      if (cmd === 'voegrij' && args[1]?.startsWith('@')) {
        const target = args[1].slice(1);
        const res = await pool.query('SELECT tiktok_id FROM users WHERE username ILIKE $1', [`%@${target}`]);
        if (res.rows[0]) {
          await addToQueue(res.rows[0].tiktok_id, target);
          io.emit('queue:update', await getQueue());
        }
      }
    }
  });

  // ── LIKE / FOLLOW / SHARE → BP ───────────────────────────────
  conn.on('like', async (data: any) => {
    const userId = (data.userId || '0').toString();
    if (userId === '0') return;
    const prev = pendingLikes.get(userId) || 0;
    const total = prev + (data.likeCount || 1);
    const bp = Math.floor(total / 100) - Math.floor(prev / 100);
    if (bp > 0) {
      const user = await getOrUpdateUser(userId, data.nickname, data.uniqueId);
      await addBP(BigInt(userId), bp, 'LIKE', user.display_name, false, false);
    }
    pendingLikes.set(userId, total);
  });

  conn.on('follow', async (data: any) => {
    const userId = (data.userId || '0').toString();
    if (userId === '0' || hasFollowed.has(userId)) return;
    hasFollowed.add(userId);
    const user = await getOrUpdateUser(userId, data.nickname, data.uniqueId);
    await addBP(BigInt(userId), 5, 'FOLLOW', user.display_name, false, false);
  });

  conn.on('share', async (data: any) => {
    const userId = (data.userId || '0').toString();
    if (userId === '0') return;
    const user = await getOrUpdateUser(userId, data.nickname, data.uniqueId);
    await addBP(BigInt(userId), 5, 'SHARE', user.display_name, false, false);
  });

  // ── GUEST ENTER/LEAVE → ARENA ───────────────────────────────
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
}

// ── START ─────────────────────────────────────────────────────
const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME?.trim();

initDB().then(() => {
  server.listen(4000, () => {
    console.log('BATTLEBOX BACKEND LIVE → http://localhost:4000');
    console.log('='.repeat(80));
    if (!TIKTOK_USERNAME) {
      console.error('TIKTOK_USERNAME niet ingesteld!');
      process.exit(1);
    }
    startTikTokLive(TIKTOK_USERNAME);
  });
});
