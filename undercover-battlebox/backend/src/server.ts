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
// GIFT CACHE: msgId → sender info (nooit meer Onbekend!)
// ─────────────────────────────────────────────────────────────────────────────
const giftSenderCache = new Map<string, {
  senderId: string;
  display_name: string;
  username: string;
}>();

// Auto cleanup na 3 seconden
setInterval(() => {
  const now = Date.now();
  for (const [msgId, data] of giftSenderCache) {
    if (now - (data as any).__timestamp > 3000) {
      giftSenderCache.delete(msgId);
    }
  }
}, 5000);

// ─────────────────────────────────────────────────────────────────────────────
// USER DATA + DB SYNC
// ─────────────────────────────────────────────────────────────────────────────
async function ensureUserInDB(tiktok_id: bigint, display_name: string, username: string) {
  const usernameWithAt = '@' + username.toLowerCase();
  await pool.query(`
    INSERT INTO users (tiktok_id, display_name, username, bp_total)
    VALUES ($1, $2, $3, 0)
    ON CONFLICT (tiktok_id) 
    DO UPDATE SET display_name = EXCLUDED.display_name, username = EXCLUDED.username
  `, [tiktok_id, display_name, usernameWithAt]);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTIE + EVENTS
// ─────────────────────────────────────────────────────────────────────────────
async function startTikTokLive(username: string) {
  const conn = new WebcastPushConnection(username);
  const pendingLikes = new Map<string, number>();
  const hasFollowed = new Set<string>();

  // Retry
  for (let i = 0; i < 6; i++) {
    try {
      await conn.connect();
      console.info(`Verbonden met @${username}`);
      break;
    } catch (err) {
      console.error(`Poging ${i + 1} mislukt...`);
      if (i === 5) process.exit(1);
      await new Promise(r => setTimeout(r, 7000));
    }
  }

  conn.on('connected', (state) => {
    hostId = state.hostId || '';
    console.log('='.repeat(80));
    console.log('ULTI-GUEST 100% GEDETECTEERD – KLAAR VOOR DE OORLOG');
    console.log(`Host ID: ${hostId}`);
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

    // Sla op in cache
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

  // ── STAP 2: rawData → KOPPEL AAN CACHE + PROCES GIFT
  conn.on('rawData', async (messageTypeName, binary) => {
    if (messageTypeName !== 'WebcastGiftMessage') return;

    try {
      // Je hoeft protobuf niet te laden als je tiktok-live-connector gebruikt
      // Maar we gebruiken de msgId uit common
      const message = JSON.parse(binary.toString()); // soms is het JSON!
      const common = message.common || {};
      const msgId = common.msgId?.toString();

      if (!msgId) return;

      const receiverId = message.giftExtra?.receiverUserId || hostId;
      if (!receiverId) return;

      // Haal verzender uit cache
      const cached = giftSenderCache.get(msgId);
      if (!cached || cached.senderId === '??') {
        console.log(`[GIFT] Geen verzender info (msgId: ${msgId}) → Aan: ${receiverId === hostId ? 'HOST' : 'GAST'}`);
        giftSenderCache.delete(msgId);
        return;
      }

      const { senderId, display_name, username } = cached;
      const diamonds = message.giftDetails?.diamondCount || 0;
      const giftName = message.giftDetails?.giftName || 'Onbekend';

      // Receiver info (co-host of host)
      const receiverRes = await pool.query(
        'SELECT display_name, username FROM users WHERE tiktok_id = $1',
        [receiverId]
      );
      const receiver = receiverRes.rows[0] || { display_name: 'Onbekend', username: 'onbekend' };

      const isToHost = receiverId === hostId;

      console.log('\n[GIFT VOLLEDIG GEDETECTEERD]');
      console.log(`   Van: ${display_name} (@${username}) [ID: ${senderId}]`);
      console.log(`   Aan: ${receiver.display_name} (@${receiver.username}) [ID: ${receiverId}] ${isToHost ? '(HOST)' : '(GAST)'}`);
      console.log(`   Gift: ${giftName} (${diamonds} diamonds)`);
      if (isToHost) {
        console.log(`   → STREAMTOTAAL (geen leaderboard)`);
      } else {
        console.log(`   → LEADERBOARD + ARENA`);
      }

      // 20% BP voor verzender
      if (diamonds > 0) {
        const bp = diamonds * 0.2;
        await addBP(BigInt(senderId), bp, 'GIFT', display_name, false, false);
        console.log(`[BP: +${bp.toFixed(1)} | GIFT 20%] → ${display_name}`);
      }

      // Heart Me
      if (giftName.toLowerCase().includes('heart me')) {
        await pool.query(
          `INSERT INTO users (tiktok_id, display_name, username, is_fan, fan_expires_at)
           VALUES ($1, $2, $3, true, NOW() + INTERVAL '24 hours')
           ON CONFLICT (tiktok_id) DO UPDATE SET is_fan = true, fan_expires_at = NOW() + INTERVAL '24 hours'`,
          [BigInt(senderId), display_name, '@' + username]
        );
        console.log(`Heart Me → FAN 24u (${display_name})`);
      }

      console.log('='.repeat(80));

      // Cleanup
      giftSenderCache.delete(msgId);

    } catch (err) {
      // Soms is binary geen JSON → negeer
    }
  });

  // ── REST VAN EVENTS (chat, like, follow, etc.) blijven hetzelfde
  conn.on('chat', async (data: any) => {
    const userId = BigInt(data.userId || data.uniqueId || '0');
    const display_name = data.nickname || 'Onbekend';
    const username = data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
    
    await ensureUserInDB(userId, display_name, username);
    await addBP(userId, 1, 'CHAT', display_name, false, false);
    console.log(`[CHAT] ${display_name}: ${data.comment}`);
  });

  conn.on('like', async (data: any) => {
    const userId = BigInt(data.userId || data.uniqueId || '0');
    const display_name = data.nickname || 'Onbekend';
    const username = data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
    
    await ensureUserInDB(userId, display_name, username);

    const batch = data.likeCount || 1;
    const prev = pendingLikes.get(userId.toString()) || 0;
    const total = prev + batch;
    const bp = Math.floor(total / 100) - Math.floor(prev / 100);

    if (bp > 0) await addBP(userId, bp, 'LIKE', display_name, false, false);
    pendingLikes.set(userId.toString(), total);
  });

  conn.on('follow', async (data: any) => {
    const userId = BigInt(data.userId || data.uniqueId || '0');
    if (hasFollowed.has(userId.toString())) return;
    hasFollowed.add(userId.toString());
    
    const display_name = data.nickname || 'Onbekend';
    const username = data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
    
    await ensureUserInDB(userId, display_name, username);
    await addBP(userId, 5, 'FOLLOW', display_name, false, false);
  });

  conn.on('liveRoomGuestEnter', (data: any) => {
    const userId = data.user?.userId?.toString() || '0';
    const display_name = data.user?.nickname || 'Onbekend';
    const username = data.user?.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
    
    ensureUserInDB(BigInt(userId), display_name, username);
    arenaJoin(userId, display_name, username, 'guest');
    console.log(`[JOIN] ${display_name} (@${username}) → ULTI-GUEST`);
  });

  conn.on('liveEnd', () => {
    console.log('[END] Stream beëindigd');
    arenaClear();
    giftSenderCache.clear();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────────────────
const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME?.trim() || 'JOUW_USERNAME';

initDB().then(() => {
  server.listen(4000, () => {
    console.log('BATTLEBOX BACKEND LIVE → http://localhost:4000');
    console.log('='.repeat(80));
    startTikTokLive(TIKTOK_USERNAME);
  });
});
