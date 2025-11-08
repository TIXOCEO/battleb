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
let hostId = '';

// ─────────────────────────────────────────────────────────────────────────────
// USER CACHE: userId → { display_name, username }
// ─────────────────────────────────────────────────────────────────────────────
interface UserInfo {
  display_name: string;
  username: string;
}
const userCache = new Map<string, UserInfo>();

function cacheUser(userId: string, display_name: string, username: string) {
  const cleanUsername = username.startsWith('@') ? username.slice(1) : username;
  userCache.set(userId, {
    display_name: display_name || 'Onbekend',
    username: cleanUsername || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '')
  });
}

function getCachedUser(userId: string): UserInfo {
  return userCache.get(userId) || { display_name: 'Onbekend', username: 'onbekend' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. USER DATA FUNCTIE (DB)
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// 2. CONNECTIE MET RETRY
// ─────────────────────────────────────────────────────────────────────────────
async function connectWithRetry(username: string, retries = 6): Promise<WebcastPushConnection> {
  for (let i = 0; i < retries; i++) {
    try {
      const conn = new WebcastPushConnection(username);
      await conn.connect();
      console.info(`Verbonden met @${username} (poging ${i + 1})`);
      return conn;
    } catch (err: any) {
      console.error(`Connectie mislukt (poging ${i + 1}/${retries}):`, err.message || err);
      if (i < retries - 1) await new Promise(r => setTimeout(r, 7000));
    }
  }
  throw new Error('Definitief geen verbinding met TikTok Live');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. START TIKTOK LIVE
// ─────────────────────────────────────────────────────────────────────────────
async function startTikTokLive(username: string) {
  const conn = await connectWithRetry(username);
  const pendingLikes = new Map<string, number>();
  const hasFollowed = new Set<string>();

  // ── ROOM INFO ───────────────────────────────────────────────────────────
  conn.on('connected', (state) => {
    hostId = state.hostId || state.userId || state.user?.userId || '';
    console.log('='.repeat(80));
    console.log('ULTI-GUEST 100% GEDETECTEERD – KLAAR VOOR DE OORLOG');
    console.log(`ROOM ID: ${state.roomId || 'ONBEKEND'}`);
    console.log(`Host ID: ${hostId}`);
    console.log(`Titel: ${state.title || 'Geen titel'}`);
    console.log(`Live sinds: ${new Date((state.createTime || 0) * 1000).toLocaleString('nl-NL')}`);
    console.log('='.repeat(80));
  });

  // ── GIFT EVENT: ALLE INFO VIA CACHE ─────────────────────────────────────
  conn.on('gift', async (data: any) => {
    const senderId = data.user?.userId?.toString() || '??';
    const receiverId = data.receiverUserId || data.toUserId || hostId;
    const giftName = data.giftName || 'Onbekend';
    const diamonds = data.diamondCount || 0;

    // Haal verzender + ontvanger uit cache
    const sender = getCachedUser(senderId);
    const receiver = getCachedUser(receiverId);

    console.log('\n[GIFT VOLLEDIG GEDETECTEERD]');
    console.log(`   Van: ${sender.display_name} (@${sender.username}) [ID: ${senderId}]`);
    console.log(`   Aan: ${receiver.display_name} (@${receiver.username}) [ID: ${receiverId}] ${receiverId === hostId ? '(HOST)' : '(GAST)'}`);
    console.log(`   Gift: ${giftName} (${diamonds} diamonds)`);
    console.log('='.repeat(70));

    // Heart Me → FAN
    if (giftName.toLowerCase().includes('heart me') && senderId !== '??') {
      const userId = BigInt(senderId);
      await pool.query(
        `INSERT INTO users (tiktok_id, display_name, username, is_fan, fan_expires_at)
         VALUES ($1, $2, $3, true, NOW() + INTERVAL '24 hours')
         ON CONFLICT (tiktok_id) DO UPDATE SET is_fan = true, fan_expires_at = NOW() + INTERVAL '24 hours'`,
        [userId, sender.display_name, '@' + sender.username]
      );
      const { isFan, isVip } = await getUserData(userId, sender.display_name, sender.username);
      await addBP(userId, 0.5, 'GIFT', sender.display_name, isFan, isVip);
      console.log(`Heart Me → FAN 24u (${sender.display_name})`);
      return;
    }

    // === HIER KOMT LATER DIAMONDS PER RONDE ===
    // await addDiamondsToArena(receiverId, diamonds);
  });

  // ── USER CACHE OPBOUWEN VIA EVENTS ──────────────────────────────────────
  conn.on('liveRoomGuestEnter', (data: any) => {
    if (!data.user) return;
    const userId = data.user.userId?.toString() || data.userId?.toString();
    const display_name = data.user.nickname || data.nickname || 'Onbekend';
    const username = data.user.uniqueId || data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
    cacheUser(userId, display_name, username);
    console.log(`[JOIN] ${display_name} (@${username}) → ULTI-GUEST`);
    arenaJoin(userId, display_name, username, 'guest');
  });

  conn.on('liveRoomGuestLeave', (data: any) => {
    const userId = data.user?.userId?.toString() || data.userId?.toString();
    if (!userId) return;
    const display_name = data.user?.nickname || data.nickname || 'Onbekend';
    console.log(`[LEAVE] ${display_name} → verlaat arena`);
    arenaLeave(userId);
    userCache.delete(userId); // cleanup
  });

  conn.on('member', async (data: any) => {
    if (data.isCoHost || data.role === 'cohost') {
      const userId = BigInt(data.userId || data.uniqueId || '0').toString();
      const display_name = data.nickname || 'Onbekend';
      const username = data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
      cacheUser(userId, display_name, username);
      console.log(`[BACKUP JOIN] ${display_name} → cohost flag`);
      arenaJoin(userId, display_name, username, 'guest');
      await getUserData(BigInt(userId), display_name, username);
    }
  });

  // Fallback: chat → cache user
  conn.on('chat', async (data: any) => {
    const userId = BigInt(data.userId || data.uniqueId || '0').toString();
    const display_name = data.nickname || 'Onbekend';
    const username = data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
    cacheUser(userId, display_name, username);

    // ... (rest van je chat code)
    const rawComment = data.comment || '';
    const msg = rawComment.trim();
    const msgLower = msg.toLowerCase();
    if (!msg) return;

    const isAdmin = userId === ADMIN_ID;
    console.log(`[CHAT] ${display_name}: ${rawComment}`);

    const { isFan, isVip } = await getUserData(BigInt(userId), display_name, username);
    await addBP(BigInt(userId), 1, 'CHAT', display_name, isFan, isVip);

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

  // ── LIKE, FOLLOW, SHARE (met cache) ─────────────────────────────────────
  conn.on('like', async (data: any) => {
    const userId = BigInt(data.userId || data.uniqueId || '0').toString();
    const display_name = data.nickname || 'Onbekend';
    const username = data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
    cacheUser(userId, display_name, username);

    const batch = data.likeCount || 1;
    const prev = pendingLikes.get(userId) || 0;
    const total = prev + batch;
    const bp = Math.floor(total / 100) - Math.floor(prev / 100);

    if (bp > 0) {
      const { isFan, isVip } = await getUserData(BigInt(userId), display_name, username);
      await addBP(BigInt(userId), bp, 'LIKE', display_name, isFan, isVip);
    }
    pendingLikes.set(userId, total);
  });

  conn.on('follow', async (data: any) => {
    const userId = BigInt(data.userId || data.uniqueId || '0').toString();
    if (hasFollowed.has(userId)) return;
    hasFollowed.add(userId);
    const display_name = data.nickname || 'Onbekend';
    const username = data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
    cacheUser(userId, display_name, username);
    const { isFan, isVip } = await getUserData(BigInt(userId), display_name, username);
    await addBP(BigInt(userId), 5, 'FOLLOW', display_name, isFan, isVip);
  });

  conn.on('share', async (data: any) => {
    const userId = BigInt(data.userId || data.uniqueId || '0').toString();
    const display_name = data.nickname || 'Onbekend';
    const username = data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
    cacheUser(userId, display_name, username);
    const { isFan, isVip } = await getUserData(BigInt(userId), display_name, username);
    await addBP(BigInt(userId), 5, 'SHARE', display_name, isFan, isVip);
  });

  conn.on('liveEnd', () => {
    console.log(`[END] Stream beëindigd → arena geleegd`);
    arenaClear();
    userCache.clear();
  });

  conn.on('error', (err) => {
    console.error('TikTok Live fout:', err);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. START SERVER
// ─────────────────────────────────────────────────────────────────────────────
const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME?.trim() || 'JOUW_USERNAME';

initDB()
  .then(() => {
    server.listen(4000, () => {
      console.log('BATTLEBOX BACKEND LIVE → http://localhost:4000');
      console.log('='.repeat(80));
      startTikTokLive(TIKTOK_USERNAME);
    });
  })
  .catch((err) => {
    console.error('DB initialisatie mislukt:', err);
    process.exit(1);
  });
