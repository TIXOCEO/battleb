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
// GET + UPDATE USER VIA TIKTOK_ID – ALTIJD STABIEL + AUTO-UPDATE
// ─────────────────────────────────────────────────────────────────────────────
async function getOrUpdateUser(
  tiktok_id: string,
  nickname?: string,
  uniqueId?: string
): Promise<{
  id: string;
  display_name: string;
  username: string;
}> {
  if (!tiktok_id || tiktok_id === '??') {
    return { id: '??', display_name: 'Onbekend', username: 'onbekend' };
  }

  const id = BigInt(tiktok_id);

  let { rows } = await pool.query(
    'SELECT display_name, username FROM users WHERE tiktok_id = $1',
    [id]
  );

  if (rows[0]) {
    const currentName = rows[0].display_name;
    const currentUsername = rows[0].username;

    if (nickname && nickname !== 'Onbekend' && nickname !== currentName) {
      const cleanUsername = uniqueId || nickname.toLowerCase().replace(/[^a-z0-9_]/g, '');
      const finalUsername = cleanUsername.startsWith('@') ? cleanUsername : '@' + cleanUsername;

      await pool.query(
        `UPDATE users SET display_name = $1, username = $2 WHERE tiktok_id = $3`,
        [nickname, finalUsername, id]
      );

      console.log(`[UPDATE] ${currentName} → ${nickname} (@${cleanUsername})`);
      return { id: tiktok_id, display_name: nickname, username: cleanUsername };
    }

    const cleanUsername = currentUsername.startsWith('@') ? currentUsername.slice(1) : currentUsername;
    return { id: tiktok_id, display_name: currentName, username: cleanUsername };
  }

  const display_name = nickname && nickname !== 'Onbekend' ? nickname : `Onbekend#${tiktok_id.slice(-5)}`;
  const rawUsername = uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
  const username = rawUsername.startsWith('@') ? rawUsername : '@' + rawUsername;

  await pool.query(
    `INSERT INTO users (tiktok_id, display_name, username, bp_total)
     VALUES ($1, $2, $3, 0)`,
    [id, display_name, username]
  );

  console.log(`[NIEUW] ${display_name} (@${rawUsername.slice(1)})`);
  return {
    id: tiktok_id,
    display_name,
    username: rawUsername.startsWith('@') ? rawUsername.slice(1) : rawUsername
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// START TIKTOK LIVE
// ─────────────────────────────────────────────────────────────────────────────
async function startTikTokLive(username: string) {
  const conn = new WebcastPushConnection(username);
  const pendingLikes = new Map<string, number>();
  const hasFollowed = new Set<string>();

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
    hostId = state.hostId || state.userId || state.user?.userId || '';
    
    if (!hostId) {
      console.error('HOST ID NIET GEVONDEN!');
      return;
    }

    // HOST WORDT NU METEEN IN DB GEZET
    const hostNickname = state.user?.nickname || state.nickname || 'Host';
    const hostUniqueId = state.user?.uniqueId || state.uniqueId;

    await getOrUpdateUser(hostId, hostNickname, hostUniqueId);

    console.log('='.repeat(80));
    console.log('BATTLEBOX LIVE – HOST DIRECT IN DB');
    console.log(`Host: ${hostNickname} (@${hostUniqueId || 'onbekend'}) [ID: ${hostId}]`);
    console.log('='.repeat(80));
  });

  // ── GIFT
  conn.on('gift', async (data: any) => {
    try {
      const senderId = (
        data.user?.userId ||
        data.sender?.userId ||
        data.senderUserId ||
        data.userId ||
        '??'
      )?.toString();

      const receiverId = (
        data.receiverUserId ||
        data.toUserId ||
        hostId ||
        '??'
      )?.toString();

      if (senderId === '??' || receiverId === '??') return;

      const diamonds = data.diamondCount || 0;
      const giftName = data.giftName || 'Onbekend';

      const [sender, receiver] = await Promise.all([
        getOrUpdateUser(
          senderId,
          data.user?.nickname || data.sender?.nickname,
          data.user?.uniqueId || data.sender?.uniqueId
        ),
        getOrUpdateUser(
          receiverId,
          data.toUser?.nickname || data.receiverNickname,
          data.toUser?.uniqueId
        )
      ]);

      const isToHost = receiverId === hostId;

      console.log('\n[GIFT] – PERFECT');
      console.log(`   Van: ${sender.display_name} (@${sender.username})`);
      console.log(`   Aan: ${receiver.display_name} (@${receiver.username}) ${isToHost ? '(HOST)' : '(GAST)'}`);
      console.log(`   Gift: ${giftName} (${diamonds} diamonds)`);

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
        console.log(`[BP +${bp.toFixed(1)}] → ${sender.display_name}`);
      }

      if (giftName.toLowerCase().includes('heart me')) {
        await pool.query(
          `INSERT INTO users (tiktok_id, is_fan, fan_expires_at)
           VALUES ($1, true, NOW() + INTERVAL '24 hours')
           ON CONFLICT (tiktok_id) DO UPDATE
           SET is_fan = true, fan_expires_at = NOW() + INTERVAL '24 hours'`,
          [BigInt(senderId)]
        );
      }

      console.log('='.repeat(80));
    } catch (err: any) {
      console.error('[GIFT FOUT]', err.message);
    }
  });

  // ── CHAT + ADMIN COMMANDS (ongewijzigd)
  conn.on('chat', async (data: any) => {
    const rawComment = data.comment || '';
    const msg = rawComment.trim();
    if (!msg) return;

    const userId = BigInt(data.userId || data.uniqueId || '0');
    const user = await getOrUpdateUser(userId.toString(), data.nickname, data.uniqueId);

    console.log(`[CHAT] ${user.display_name}: ${rawComment}`);

    const { rows } = await pool.query(
      'SELECT is_fan, fan_expires_at, is_vip, vip_expires_at FROM users WHERE tiktok_id = $1',
      [userId]
    );
    const row = rows[0] || {};
    const isFan = row.is_fan && row.fan_expires_at && new Date(row.fan_expires_at) > new Date();
    const isVip = row.is_vip && row.vip_expires_at && new Date(row.vip_expires_at) > new Date();

    await addBP(userId, 1, 'CHAT', user.display_name, isFan, isVip);

    // ADMIN COMMANDS
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
      case 'geef': {
        const amount = parseFloat(args[2]);
        if (isNaN(amount) || amount <= 0) return;
        await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [amount, targetId]);
        console.log(`[ADMIN] +${amount} BP → ${rawUsername}`);
        break;
      }
      case 'verw': {
        const amount = parseFloat(args[2]);
        if (isNaN(amount) || amount <= 0) return;
        await pool.query('UPDATE users SET bp_total = GREATEST(bp_total - $1, 0) WHERE tiktok_id = $2', [amount, targetId]);
        console.log(`[ADMIN] -${amount} BP → ${rawUsername}`);
        break;
      }
      case 'voegrij': {
        await addToQueue(targetId.toString(), targetDisplay);
        require('./queue').emitQueue();
        console.log(`[ADMIN] ${rawUsername} → wachtrij`);
        break;
      }
      case 'verwrij': {
        const refund = await leaveQueue(targetId.toString());
        if (refund > 0) {
          const half = Math.floor(refund * 0.5);
          await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [half, targetId]);
          console.log(`[ADMIN] ${rawUsername} verwijderd → +${half} BP refund`);
        }
        require('./queue').emitQueue();
        break;
      }
      case 'geefvip': {
        await pool.query('UPDATE users SET is_vip = true, vip_expires_at = NOW() + INTERVAL \'30 days\' WHERE tiktok_id = $1', [targetId]);
        console.log(`[ADMIN] VIP 30 dagen → ${rawUsername}`);
        break;
      }
      case 'verwvip': {
        await pool.query('UPDATE users SET is_vip = false, vip_expires_at = NULL WHERE tiktok_id = $1', [targetId]);
        console.log(`[ADMIN] VIP verwijderd → ${rawUsername}`);
        break;
      }
    }
  });

  // ── LIKE, FOLLOW, SHARE, GUEST (ongewijzigd)
  conn.on('like', async (data: any) => {
    const userId = (data.userId || data.uniqueId || '0').toString();
    if (userId === '0') return;

    const user = await getOrUpdateUser(userId, data.nickname, data.uniqueId);
    const prev = pendingLikes.get(userId) || 0;
    const total = prev + (data.likeCount || 1);
    const bp = Math.floor(total / 100) - Math.floor(prev / 100);
    if (bp > 0) {
      await addBP(BigInt(userId), bp, 'LIKE', user.display_name, false, false);
    }
    pendingLikes.set(userId, total);
  });

  conn.on('follow', async (data: any) => {
    const userId = (data.userId || data.uniqueId || '0').toString();
    if (userId === '0' || hasFollowed.has(userId)) return;
    hasFollowed.add(userId);

    const user = await getOrUpdateUser(userId, data.nickname, data.uniqueId);
    await addBP(BigInt(userId), 5, 'FOLLOW', user.display_name, false, false);
  });

  conn.on('share', async (data: any) => {
    const userId = (data.userId || data.uniqueId || '0').toString();
    if (userId === '0') return;

    const user = await getOrUpdateUser(userId, data.nickname, data.uniqueId);
    await addBP(BigInt(userId), 5, 'SHARE', user.display_name, false, false);
  });

  conn.on('liveRoomGuestEnter', async (data: any) => {
    const userId = (data.user?.userId || data.userId || '0').toString();
    if (userId === '0') return;

    const user = await getOrUpdateUser(userId, data.user?.nickname, data.user?.uniqueId);
    arenaJoin(userId, user.display_name, user.username, 'guest');
    console.log(`[JOIN] ${user.display_name} (@${user.username}) → ARENA`);
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
}

// ─────────────────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────────────────
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
