// backend/src/server.ts
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { EulerClient } from '@eulerstream/euler-websocket-sdk';
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
const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME?.trim()?.replace('@', '') || 'JOUW_USERNAME';
const EULER_API_KEY = process.env.EULER_API_KEY?.trim();

if (!EULER_API_KEY) {
  console.error('ERROR: Voeg EULER_API_KEY toe aan je .env!');
  process.exit(1);
}

// === EULER STREAM – DE NIEUWE MOTOR (vervangt tiktok-live-connector) ===
const euler = new EulerClient({
  apiKey: EULER_API_KEY,
  uniqueId: TIKTOK_USERNAME,
  reconnect: true,
  debug: false
});

const pendingLikes = new Map<string, number>();
const hasFollowed = new Set<string>();

async function getUserData(tiktok_id: bigint, display_name: string, username: string) {
  const usernameWithAt = '@' + username.toLowerCase();
  const query = `
    INSERT INTO users (tiktok_id, display_name, username, bp_total, is_fan, fan_expires_at, is_vip, vip_expires_at)
    VALUES ($1, $2, $Fractions3, 0, false, NULL, false, NULL)
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

// === EULER EVENTS ===
euler.on('connected', (state) => {
  console.log('='.repeat(80));
  console.log('EULER STREAM VERBONDEN – MULTI-GUEST 100% WERKENDE');
  console.log(`ROOM ID: ${state.roomId || 'ONBEKEND'}`);
  console.log(`Titel: ${state.title || 'Geen titel'}`);
  console.log(`Live sinds: ${new Date(state.createTime * 1000).toLocaleString('nl-NL')}`);
  console.log('='.repeat(80));
});

euler.on('liveEnd', () => {
  console.log(`[END] Stream beëindigd → arena geleegd`);
  arenaClear();
});

// === MULTI-GUEST JOIN / LEAVE – PERFECT WERKENDE ===
euler.on('member', (event) => {
  if (event.user.isHost) return;

  const userId = event.user.userId?.toString() || event.user.uniqueId;
  const display_name = event.user.nickname || 'Onbekend';
  const tikTokUsername = event.user.uniqueId;

  if (event.action === 'join') {
    console.log(`[JOIN] ${display_name} (@${tikTokUsername}) → ULTI-GUEST`);
    arenaJoin(userId, display_name, tikTokUsername, 'guest');
  }

  if (event.action === 'leave') {
    console.log(`[LEAVE] ${display_name} → verlaat arena`);
    arenaLeave(userId);
  }
});

// === CHAT + ADMIN COMMANDS (100% jouw originele logica) ===
euler.on('chat', async (event) => {
  const rawComment = event.message || '';
  const msg = rawComment.trim();
  const msgLower = msg.toLowerCase();
  if (!msg) return;

  const userId = BigInt(event.user.userId || '0');
  const display_name = event.user.nickname || 'Onbekend';
  const tikTokUsername = event.user.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
  const isAdmin = userId.toString() === ADMIN_ID;

  console.log(`[CHAT] ${display_name}: ${rawComment}`);

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
    console.log(`[ADMIN] Niet gevonden: ${rawUsername}`);
    return;
  }

  const targetId = targetRes.rows[0].tiktok_id;
  const targetDisplay = targetRes.rows[0].display_name || rawUsername;

  switch (cmd) {
    case 'geef':
      if (!args[2]) return;
      const giveAmount = parseFloat(args[2]);
      if (isNaN(giveAmount) || giveAmount <= 0) return;
      await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [giveAmount, targetId]);
      console.log(`[ADMIN] +${giveAmount} BP → ${rawUsername}`);
      break;

    case 'verw':
      if (!args[2]) return;
      const takeAmount = parseFloat(args[2]);
      if (isNaN(takeAmount) || takeAmount <= 0) return;
      await pool.query('UPDATE users SET bp_total = GREATEST(bp_total - $1, 0) WHERE tiktok_id = $2', [takeAmount, targetId]);
      console.log(`[ADMIN] -${takeAmount} BP → ${rawUsername}`);
      break;

    case 'voegrij':
      await addToQueue(targetId.toString(), targetDisplay);
      require('./queue').emitQueue();
      console.log(`[ADMIN] ${rawUsername} → wachtrij`);
      break;

    case 'verwrij':
      const refund = await leaveQueue(targetId.toString());
      if (refund > 0) {
        const half = Math.floor(refund * 0.5);
        await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [half, targetId]);
        console.log(`[ADMIN] ${rawUsername} verwijderd → +${half} BP refund`);
      }
      require('./queue').emitQueue();
      break;

    case 'geefvip':
      await pool.query('UPDATE users SET is_vip = true, vip_expires_at = NOW() + INTERVAL \'30 days\' WHERE tiktok_id = $1', [targetId]);
      console.log(`[ADMIN] VIP 30 dagen → ${rawUsername}`);
      break;

    case 'verwvip':
      await pool.query('UPDATE users SET is_vip = false, vip_expires_at = NULL WHERE tiktok_id = $1', [targetId]);
      console.log(`[ADMIN] VIP verwijderd → ${rawUsername}`);
      break;
  }
});

// === GIFT (100% jouw originele logica) ===
euler.on('gift', async (event) => {
  const userId = BigInt(event.user.userId || '0');
  const display_name = event.user.nickname || 'Onbekend';
  const tikTokUsername = event.user.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
  const giftName = (event.gift.name || '').toLowerCase();

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

  const diamonds = event.gift.diamondCount || 0;
  const bp = diamonds * 0.5;
  if (bp <= 0) return;

  const { isFan, isVip } = await getUserData(userId, display_name, tikTokUsername);
  await addBP(userId, bp, 'GIFT', display_name, isFan, isVip);
  console.log(`${event.gift.name} (${diamonds} diamonds) → +${bp} BP`);
});

// === LIKE (jouw batch logica) ===
euler.on('like', async (event) => {
  const userId = BigInt(event.user.userId || '0');
  const display_name = event.user.nickname || 'Onbekend';
  const tikTokUsername = event.user.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');

  const batch = event.likeCount || 1;
  const prev = pendingLikes.get(userId.toString()) || 0;
  const total = prev + batch;
  const bp = Math.floor(total / 100) - Math.floor(prev / 100);

  if (bp > 0) {
    const { isFan, isVip } = await getUserData(userId, display_name, tikTokUsername);
    await addBP(userId, bp, 'LIKE', display_name, isFan, isVip);
  }
  pendingLikes.set(userId.toString(), total);
});

// === FOLLOW & SHARE (jouw logica) ===
euler.on('follow', async (event) => {
  const userId = BigInt(event.user.userId || '0');
  if (hasFollowed.has(userId.toString())) return;
  hasFollowed.add(userId.toString());
  const display_name = event.user.nickname || 'Onbekend';
  const tikTokUsername = event.user.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
  const { isFan, isVip } = await getUserData(userId, display_name, tikTokUsername);
  await addBP(userId, 5, 'FOLLOW', display_name, isFan, isVip);
});

euler.on('share', async (event) => {
  const userId = BigInt(event.user.userId || '0');
  const display_name = event.user.nickname || 'Onbekend';
  const tikTokUsername = event.user.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
  const { isFan, isVip } = await getUserData(userId, display_name, tikTokUsername);
  await addBP(userId, 5, 'SHARE', display_name, isFan, isVip);
});

// === START SERVER ===
initDB()
  .then(() => {
    server.listen(4000, () => {
      console.log('BATTLEBOX BACKEND LIVE → http://localhost:4000');
      console.log('='.repeat(80));
      euler.connect().catch(err => {
        console.error('Euler kon niet verbinden:', err);
        process.exit(1);
      });
    });
  })
  .catch((err) => {
    console.error('DB initialisatie mislukt:', err);
    process.exit(1);
  });
