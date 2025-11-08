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

app.get('/queue', async (req, res) => res.json(await getQueue()));
app.get('/arena', async (req, res) => res.json(getArena()));

io.on('connection', (socket) => {
  console.log('Dashboard connected:', socket.id);
  require('./queue').emitQueue();
  require('./game').emitArena();
});

const ADMIN_ID = process.env.ADMIN_TIKTOK_ID?.trim();
let hostId = '';

// ─────────────────────────────────────────────────────────────────────────────
// GIFT CACHE: msgId → sender info (NOOIT meer Onbekend!)
// ─────────────────────────────────────────────────────────────────────────────
interface GiftSenderCacheEntry {
  senderId: string;
  display_name: string;
  username: string;
  __timestamp: number;
}
const giftSenderCache = new Map<string, GiftSenderCacheEntry>();

// Auto cleanup oude entries
setInterval(() => {
  const now = Date.now();
  for (const [msgId, entry] of giftSenderCache.entries()) {
    if (now - entry.__timestamp > 3000) {
      giftSenderCache.delete(msgId);
    }
  }
}, 5000);

// ─────────────────────────────────────────────────────────────────────────────
// GEEF USER IN DB (altijd naam + username)
// ─────────────────────────────────────────────────────────────────────────────
async function ensureUserInDB(tiktok_id: bigint, display_name: string, username: string) {
  const usernameWithAt = '@' + username.toLowerCase();
  await pool.query(`
    INSERT INTO users (tiktok_id, display_name, username, bp_total)
    VALUES ($1, $2, $3, 0)
    ON CONFLICT (tiktok_id) 
    DO UPDATE SET 
      display_name = EXCLUDED.display_name,
      username = EXCLUDED.username
  `, [tiktok_id, display_name || 'Onbekend', usernameWithAt]);
}

// ─────────────────────────────────────────────────────────────────────────────
// START TIKTOK LIVE
// ─────────────────────────────────────────────────────────────────────────────
async function startTikTokLive(username: string) {
  const conn = new WebcastPushConnection(username);
  const pendingLikes = new Map<string, number>();
  const hasFollowed = new Set<string>();

  // Retry connectie
  for (let i = 0; i < 6; i++) {
    try {
      await conn.connect();
      console.info(`Verbonden met @${username} (poging ${i + 1})`);
      break;
    } catch (err: any) {
      console.error(`Connectie mislukt (poging ${i + 1}/6):`, err.message || err);
      if (i === 5) process.exit(1);
      await new Promise(r => setTimeout(r, 7000));
    }
  }

  conn.on('connected', (state) => {
    hostId = state.hostId || state.userId || '';
    console.log('='.repeat(80));
    console.log('ULTI-GUEST 100% GEDETECTEERD – KLAAR VOOR DE OORLOG');
    console.log(`ROOM ID: ${state.roomId || 'ONBEKEND'}`);
    console.log(`Host ID: ${hostId}`);
    console.log(`Titel: ${state.title || 'Geen titel'}`);
    console.log('='.repeat(80));
  });

  // ── STAP 1: gift event → SLA VERZENDER OP IN CACHE
  conn.on('gift', (data: any) => {
    const msgId = data.common?.msgId || data.msgId;
    if (!msgId) return;

    const sender = data.user || {};
    const senderId = sender.userId?.toString() || '??';
    const display_name = sender.nickname || 'Onbekend';
    const username = (sender.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, ''));

    giftSenderCache.set(msgId.toString(), {
      senderId,
      display_name,
      username,
      __timestamp: Date.now()
    });

    // Zorg dat verzender in DB staat
    if (senderId !== '??') {
      ensureUserInDB(BigInt(senderId), display_name, username);
    }
  });

  // ── STAP 2: rawData → KOPPEL MET CACHE + PROCES GIFT
  conn.on('rawData', async (messageTypeName, binary) => {
    if (messageTypeName !== 'WebcastGiftMessage') return;

    try {
      // tiktok-live-connector stuurt soms JSON, soms binary → probeer beide
      let message: any;
      try {
        message = JSON.parse(binary.toString());
      } catch {
        return; // negeer echte protobuf binary
      }

      const common = message.common || {};
      const msgId = common.msgId?.toString();
      if (!msgId) return;

      const receiverId = message.giftExtra?.receiverUserId || hostId;
      if (!receiverId) return;

      const cached = giftSenderCache.get(msgId);
      if (!cached || cached.senderId === '??') {
        console.log(`[GIFT] Geen verzender info (msgId: ${msgId}) → Aan: ${receiverId === hostId ? 'HOST' : 'GAST'}`);
        giftSenderCache.delete(msgId);
        return;
      }

      const { senderId, display_name, username } = cached;
      const diamonds = message.giftDetails?.diamondCount || 0;
      const giftName = message.giftDetails?.giftName || 'Onbekend';

      // Receiver info ophalen
      const receiverRes = await pool.query(
        'SELECT display_name, username FROM users WHERE tiktok_id = $1',
        [receiverId]
      );
      const receiver = receiverRes.rows[0] || { display_name: 'Onbekend', username: 'onbekend' };
      const cleanReceiverUsername = receiver.username?.startsWith('@') ? receiver.username.slice(1) : receiver.username;

      const isToHost = receiverId === hostId;

      console.log('\n[GIFT VOLLEDIG GEDETECTEERD]');
      console.log(`   Van: ${display_name} (@${username}) [ID: ${senderId}]`);
      console.log(`   Aan: ${receiver.display_name} (@${cleanReceiverUsername}) [ID: ${receiverId}] ${isToHost ? '(HOST)' : '(GAST)'}`);
      console.log(`   Gift: ${giftName} (${diamonds} diamonds)`);
      if (isToHost) {
        console.log(`   → STREAMTOTAAL (geen leaderboard)`);
      } else {
        console.log(`   → LEADERBOARD + ARENA`);
      }

      // 20% BP voor verzender
      if (diamonds > 0) {
        const bp = diamonds * 0.2;
        const { rows } = await pool.query(
          'SELECT is_fan, fan_expires_at, is_vip, vip_expires_at FROM users WHERE tiktok_id = $1',
          [senderId]
        );
        const user = rows[0] || {};
        const isFan = user.is_fan && user.fan_expires_at && new Date(user.fan_expires_at) > new Date();
        const isVip = user.is_vip && user.vip_expires_at && new Date(user.vip_expires_at) > new Date();

        await addBP(BigInt(senderId), bp, 'GIFT', display_name, isFan, isVip);
        console.log(`[BP: +${bp.toFixed(1)} | GIFT 20%] → ${display_name}`);
      }

      // Heart Me → FAN 24u
      if (giftName.toLowerCase().includes('heart me')) {
        await pool.query(`
          INSERT INTO users (tiktok_id, display_name, username, is_fan, fan_expires_at)
          VALUES ($1, $2, $3, true, NOW() + INTERVAL '24 hours')
          ON CONFLICT (tiktok_id) 
          DO UPDATE SET is_fan = true, fan_expires_at = NOW() + INTERVAL '24 hours'
        `, [BigInt(senderId), display_name, '@' + username]);
        console.log(`Heart Me → FAN 24u (${display_name}) [FAN]`);
      }

      console.log('='.repeat(80));
      giftSenderCache.delete(msgId);

    } catch (err) {
      // negeer parse errors
    }
  });

  // ── CHAT
  conn.on('chat', async (data: any) => {
    const userId = BigInt(data.userId || data.uniqueId || '0');
    const display_name = data.nickname || 'Onbekend';
    const username = data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');

    await ensureUserInDB(userId, display_name, username);
    const { rows } = await pool.query(
      'SELECT is_fan, fan_expires_at, is_vip, vip_expires_at FROM users WHERE tiktok_id = $1',
      [userId]
    );
    const user = rows[0] || {};
    const isFan = user.is_fan && user.fan_expires_at && new Date(user.fan_expires_at) > new Date();
    const isVip = user.is_vip && user.vip_expires_at && new Date(user.vip_expires_at) > new Date();

    await addBP(userId, 1, 'CHAT', display_name, isFan, isVip);
    console.log(`[CHAT] ${display_name}: ${data.comment || ''}`);
  });

  // ── LIKE
  conn.on('like', async (data: any) => {
    const userId = BigInt(data.userId || data.uniqueId || '0');
    const display_name = data.nickname || 'Onbekend';
    const username = data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');

    await ensureUserInDB(userId, display_name, username);

    const batch = data.likeCount || 1;
    const prev = pendingLikes.get(userId.toString()) || 0;
    const total = prev + batch;
    const bp = Math.floor(total / 100) - Math.floor(prev / 100);

    if (bp > 0) {
      const { rows } = await pool.query(
        'SELECT is_fan, fan_expires_at, is_vip, vip_expires_at FROM users WHERE tiktok_id = $1',
        [userId]
      );
      const user = rows[0] || {};
      const isFan = user.is_fan && user.fan_expires_at && new Date(user.fan_expires_at) > new Date();
      const isVip = user.is_vip && user.vip_expires_at && new Date(user.vip_expires_at) > new Date();

      await addBP(userId, bp, 'LIKE', display_name, isFan, isVip);
    }
    pendingLikes.set(userId.toString(), total);
  });

  // ── FOLLOW & SHARE
  conn.on('follow', async (data: any) => {
    const userId = BigInt(data.userId || data.uniqueId || '0');
    if (hasFollowed.has(userId.toString())) return;
    hasFollowed.add(userId.toString());

    const display_name = data.nickname || 'Onbekend';
    const username = data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');

    await ensureUserInDB(userId, display_name, username);
    await addBP(userId, 5, 'FOLLOW', display_name, false, false);
  });

  conn.on('share', async (data: any) => {
    const userId = BigInt(data.userId || data.uniqueId || '0');
    const display_name = data.nickname || 'Onbekend';
    const username = data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');

    await ensureUserInDB(userId, display_name, username);
    await addBP(userId, 5, 'SHARE', display_name, false, false);
  });

  // ── GUEST EVENTS
  conn.on('liveRoomGuestEnter', (data: any) => {
    if (!data.user) return;
    const userId = data.user.userId?.toString() || data.userId?.toString();
    const display_name = data.user.nickname || data.nickname || 'Onbekend';
    const username = data.user.uniqueId || data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');

    ensureUserInDB(BigInt(userId), display_name, username);
    arenaJoin(userId, display_name, username, 'guest');
    console.log(`[JOIN] ${display_name} (@${username}) → ULTI-GUEST`);
  });

  conn.on('liveRoomGuestLeave', (data: any) => {
    const userId = data.user?.userId?.toString() || data.userId?.toString();
    if (!userId) return;
    arenaLeave(userId);
    console.log(`[LEAVE] ${data.user?.nickname || 'Onbekend'} → verlaat arena`);
  });

  conn.on('liveEnd', () => {
    console.log('[END] Stream beëindigd → arena geleegd');
    arenaClear();
    giftSenderCache.clear();
  });

  conn.on('error', (err) => {
    console.error('TikTok Live fout:', err);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────────────────────────
const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME?.trim() || 'JOUW_USERNAME';

initDB().then(() => {
  server.listen(4000, () => {
    console.log('BATTLEBOX BACKEND LIVE → http://localhost:4000');
    console.log('='.repeat(80));
    startTikTokLive(TIKTOK_USERNAME);
  });
}).catch(err => {
  console.error('DB initialisatie mislukt:', err);
  process.exit(1);
});
