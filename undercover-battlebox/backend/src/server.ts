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
// ZORG DAT USER BESTAAT + HAAL NAAM OP (NOOIT meer Onbekend!)
// ─────────────────────────────────────────────────────────────────────────────
async function ensureUser(tiktok_id: string, fallback_name?: string, fallback_username?: string) {
  if (tiktok_id === '??' || !tiktok_id) return { id: '??', display_name: 'Onbekend', username: 'onbekend' };

  const id = BigInt(tiktok_id);
  const name = fallback_name || 'Onbekend';
  const username = fallback_username || name.toLowerCase().replace(/[^a-z0-9_]/g, '');

  await pool.query(`
    INSERT INTO users (tiktok_id, display_name, username, bp_total)
    VALUES ($1, $2, $3, 0)
    ON CONFLICT (tiktok_id) DO UPDATE
    SET display_name = COALESCE(EXCLUDED.display_name, users.display_name),
        username = COALESCE(EXCLUDED.username, users.username)
  `, [id, name, '@' + username]);

  const { rows } = await pool.query(
    'SELECT display_name, username FROM users WHERE tiktok_id = $1',
    [id]
  );

  if (!rows[0]) return { id: tiktok_id, display_name: name, username };

  const cleanUsername = rows[0].username.startsWith('@') ? rows[0].username.slice(1) : rows[0].username;
  return {
    id: tiktok_id,
    display_name: rows[0].display_name || name,
    username: cleanUsername
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// START TIKTOK LIVE
// ─────────────────────────────────────────────────────────────────────────────
async function startTikTokLive(username: string) {
  const conn = new WebcastPushConnection(username);
  const pendingLikes = new Map<string, number>();
  const hasFollowed = new Set<string>();

  // Connectie met retry
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
    hostId = state.hostId || state.userId || state.user?.userId || '';
    console.log('='.repeat(80));
    console.log('ULTI-GUEST 100% GEDETECTEERD – KLAAR VOOR DE OORLOG');
    console.log(`ROOM ID: ${state.roomId || 'ONBEKEND'}`);
    console.log(`Host ID: ${hostId}`);
    console.log(`Titel: ${state.title || 'Geen titel'}`);
    console.log(`Live sinds: ${new Date((state.createTime || 0) * 1000).toLocaleString('nl-NL')}`);
    console.log('='.repeat(80));
  });

  // ── GIFT EVENT: ALLES WAT WE NODIG HEBBEN IS HIER
  conn.on('gift', async (data: any) => {
    const senderId = (data.user?.userId || data.senderUserId || data.userId || '??').toString();
    const receiverId = (data.receiverUserId || data.toUserId || hostId || '??').toString();
    const diamonds = data.diamondCount || 0;
    const giftName = data.giftName || 'Onbekend';

    if (senderId === '??') {
      console.log(`[GIFT] Geen sender ID → skipped`);
      return;
    }

    // Zorg dat beide users in DB staan
    const [sender, receiver] = await Promise.all([
      ensureUser(
        senderId,
        data.user?.nickname,
        data.user?.uniqueId
      ),
      ensureUser(
        receiverId,
        data.toUser?.nickname || data.receiverNickname,
        data.toUser?.uniqueId
      )
    ]);

    const isToHost = receiverId === hostId;

    console.log('\n[GIFT VOLLEDIG GEDETECTEERD]');
    console.log(`   Van: ${sender.display_name} (@${sender.username}) [ID: ${senderId}]`);
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
      const { rows } = await pool.query(
        'SELECT is_fan, fan_expires_at, is_vip, vip_expires_at FROM users WHERE tiktok_id = $1',
        [senderId]
      );
      const user = rows[0] || {};
      const isFan = user.is_fan && user.fan_expires_at && new Date(user.fan_expires_at) > new Date();
      const isVip = user.is_vip && user.vip_expires_at && new Date(user.vip_expires_at) > new Date();

      await addBP(BigInt(senderId), bp, 'GIFT', sender.display_name, isFan, isVip);
      console.log(`[BP: +${bp.toFixed(1)} | GIFT 20%] → ${sender.display_name}`);
    }

    // Heart Me → FAN 24u
    if (giftName.toLowerCase().includes('heart me')) {
      await pool.query(`
        INSERT INTO users (tiktok_id, is_fan, fan_expires_at)
        VALUES ($1, true, NOW() + INTERVAL '24 hours')
        ON CONFLICT (tiktok_id) DO UPDATE
        SET is_fan = true, fan_expires_at = NOW() + INTERVAL '24 hours'
      `, [BigInt(senderId)]);
      console.log(`Heart Me → FAN 24u (${sender.display_name}) [FAN]`);
    }

    console.log('='.repeat(80));
  });

  // ── CHAT + ADMIN COMMANDS
  conn.on('chat', async (data: any) => {
    const rawComment = data.comment || '';
    const msg = rawComment.trim();
    if (!msg) return;

    const userId = BigInt(data.userId || data.uniqueId || '0');
    const display_name = data.nickname || 'Onbekend';
    const tikTokUsername = data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');

    console.log(`[CHAT] ${display_name}: ${rawComment}`);

    const { isFan, isVip } = await (async () => {
      await ensureUser(userId.toString(), display_name, tikTokUsername);
      const { rows } = await pool.query(
        'SELECT is_fan, fan_expires_at, is_vip, vip_expires_at FROM users WHERE tiktok_id = $1',
        [userId]
      );
      const row = rows[0] || {};
      return {
        isFan: row.is_fan && row.fan_expires_at && new Date(row.fan_expires_at) > new Date(),
        isVip: row.is_vip && row.vip_expires_at && new Date(row.vip_expires_at) > new Date()
      };
    })();

    await addBP(userId, 1, 'CHAT', display_name, isFan, isVip);

    // Admin commands
    const msgLower = msg.toLowerCase();
    const isAdmin = userId.toString() === ADMIN_ID;
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

  // ── LIKE (batch)
  conn.on('like', async (data: any) => {
    const userId = BigInt(data.userId || data.uniqueId || '0');
    const display_name = data.nickname || 'Onbekend';
    const tikTokUsername = data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');

    await ensureUser(userId.toString(), display_name, tikTokUsername);

    const batch = data.likeCount || 1;
    const prev = pendingLikes.get(userId.toString()) || 0;
    const total = prev + batch;
    const bp = Math.floor(total / 100) - Math.floor(prev / 100);

    if (bp > 0) {
      const { rows } = await pool.query(
        'SELECT is_fan, fan_expires_at, is_vip, vip_expires_at FROM users WHERE tiktok_id = $1',
        [userId]
      );
      const row = rows[0] || {};
      const isFan = row.is_fan && row.fan_expires_at && new Date(row.fan_expires_at) > new Date();
      const isVip = row.is_vip && row.vip_expires_at && new Date(row.vip_expires_at) > new Date();

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
    const tikTokUsername = data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');

    await ensureUser(userId.toString(), display_name, tikTokUsername);
    await addBP(userId, 5, 'FOLLOW', display_name, false, false);
  });

  conn.on('share', async (data: any) => {
    const userId = BigInt(data.userId || data.uniqueId || '0');
    const display_name = data.nickname || 'Onbekend';
    const tikTokUsername = data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');

    await ensureUser(userId.toString(), display_name, tikTokUsername);
    await addBP(userId, 5, 'SHARE', display_name, false, false);
  });

  // ── GUEST EVENTS
  conn.on('liveRoomGuestEnter', async (data: any) => {
    if (!data.user) return;
    const userId = data.user.userId?.toString() || data.userId?.toString();
    const display_name = data.user.nickname || data.nickname || 'Onbekend';
    const tikTokUsername = data.user.uniqueId || data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');

    await ensureUser(userId, display_name, tikTokUsername);
    arenaJoin(userId, display_name, tikTokUsername, 'guest');
    console.log(`[JOIN] ${display_name} (@${tikTokUsername}) → ULTI-GUEST`);
  });

  conn.on('liveRoomGuestLeave', (data: any) => {
    const userId = data.user?.userId?.toString() || data.userId?.toString();
    if (!userId) return;
    arenaLeave(userId);
    console.log(`[LEAVE] ${data.user?.nickname || 'Onbekend'} → verlaat arena`);
  });

  conn.on('member', async (data: any) => {
    if (data.isCoHost || data.role === 'cohost') {
      const userId = BigInt(data.userId || data.uniqueId || '0').toString();
      const display_name = data.nickname || 'Onbekend';
      const tikTokUsername = data.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
      await ensureUser(userId, display_name, tikTokUsername);
      arenaJoin(userId, display_name, tikTokUsername, 'guest');
      console.log(`[BACKUP JOIN] ${display_name} → cohost flag`);
    }
  });

  conn.on('liveEnd', () => {
    console.log(`[END] Stream beëindigd → arena geleegd`);
    arenaClear();
  });

  conn.on('error', (err) => {
    console.error('TikTok Live fout:', err);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// START SERVER
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
