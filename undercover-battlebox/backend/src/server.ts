// backend/src/server.ts
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { WebcastPushConnection } from 'tiktok-live-connector';
import { initDB } from './db';
import pool from './db';
import { addToQueue, boostQueue, leaveQueue, getQueue } from './queue';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.get('/queue', async (req, res) => {
  const queue = await getQueue();
  res.json(queue);
});

io.on('connection', (socket) => {
  console.log('Overlay connected:', socket.id);
  emitQueue();
});

async function emitQueue() {
  const queue = await getQueue();
  io.emit('queue:update', queue.slice(0, 50));
}

const hasFollowed = new Set<string>();
const pendingLikes = new Map<string, number>();

// === HEART ME = FAN VOOR 24 UUR ===
async function activateFanStatus(tiktok_id: string, username: string) {
  await pool.query(
    `INSERT INTO users (tiktok_id, username, bp_total, is_fan, fan_expires_at)
     VALUES ($1, $2, 0, true, NOW() + INTERVAL '24 hours')
     ON CONFLICT (tiktok_id) 
     DO UPDATE SET 
       is_fan = true, 
       fan_expires_at = NOW() + INTERVAL '24 hours',
       username = EXCLUDED.username`,
    [tiktok_id, username]
  );
  console.log(`[FAN ACTIVATED 24H] @${username}`);
}

// === HAAL USER + FAN STATUS OP (MET EXPIRY CHECK) ===
async function getUserData(tiktok_id: string, username: string) {
  const query = `
    INSERT INTO users (tiktok_id, username, bp_total, is_fan, fan_expires_at)
    VALUES ($1, $2, 0, false, NULL)
    ON CONFLICT (tiktok_id) 
    DO UPDATE SET username = EXCLUDED.username
    RETURNING bp_total, is_fan, fan_expires_at;
  `;

  const res = await pool.query(query, [tiktok_id, username]);
  const row = res.rows[0];

  const isFan = row.is_fan && row.fan_expires_at && new Date(row.fan_expires_at) > new Date();

  if (!row.bp_total) {
    console.log(`[NEW USER] @${username}`);
  }

  return {
    oldBP: parseFloat(row.bp_total) || 0,
    isFan
  };
}

// === BP TOEVOEGEN + LOG MET [FAN] ===
async function addBP(tiktok_id: string, amount: number, action: string, nick: string, isFan: boolean) {
  const oldRes = await pool.query('SELECT bp_total FROM users WHERE tiktok_id = $1', [tiktok_id]);
  const oldBP = parseFloat(oldRes.rows[0]?.bp_total) || 0;

  await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [amount, tiktok_id]);

  const newRes = await pool.query('SELECT bp_total FROM users WHERE tiktok_id = $1', [tiktok_id]);
  const newBP = parseFloat(newRes.rows[0].bp_total) || 0;

  const fanTag = isFan ? ' [FAN]' : '';
  console.log(`[${action}] @${nick}${fanTag}`);
  console.log(`[BP: +${amount} | ${oldBP.toFixed(1)} → ${newBP.toFixed(1)}]`);
}

async function startTikTokLive(username: string) {
  const tiktokLiveConnection = new WebcastPushConnection(username);

  tiktokLiveConnection.connect().then(state => {
    console.info(`Verbonden met roomId ${state.roomId}`);
  }).catch(err => {
    console.error('Failed to connect to TikTok Live:', err);
  });

  // === CHAT ===
  tiktokLiveConnection.on('chat', async (data: any) => {
    const rawComment = data.comment || '';
    const msg = rawComment.toLowerCase().trim();
    if (!msg) return;

    console.log(`[CHAT] Raw: "${rawComment}" → Parsed: "${msg}" (user: @${data.nickname})`);

    const user = data.uniqueId;
    const nick = data.nickname;

    const { isFan } = await getUserData(user, nick);
    await addBP(user, 1, 'CHAT', nick, isFan);

    // === COMMANDOS – ALLEEN VOOR FANS ===
    if (!isFan) {
      console.log(`[NO FAN] @${nick} probeerde commando zonder Heart Me`);
      return;
    }

    if (msg === '!join') {
      console.log(`!join ontvangen van @${nick} [FAN]`);
      try {
        await addToQueue(user, nick);
        emitQueue();
      } catch (e: any) {
        console.log('Join error:', e.message);
      }
    } else if (msg.startsWith('!boost rij ')) {
      const spots = parseInt(msg.split(' ')[2] || '0');
      if (spots >= 1 && spots <= 5) {
        console.log(`!boost rij ${spots} van @${nick} [FAN]`);
        try {
          await boostQueue(user, spots);
          emitQueue();
        } catch (e: any) {
          console.log('Boost error:', e.message);
        }
      }
    } else if (msg === '!leave') {
      console.log(`!leave ontvangen van @${nick} [FAN]`);
      try {
        const refund = await leaveQueue(user);
        if (refund > 0) console.log(`@${nick} kreeg ${refund} BP terug`);
        emitQueue();
      } catch (e: any) {
        console.log('Leave error:', e.message);
      }
    }
  });

  // === GIFT – ALLEEN HEART ME ACTIVEERT FAN ===
  tiktokLiveConnection.on('gift', async (data: any) => {
    const user = data.uniqueId;
    const nick = data.nickname;
    const giftName = data.giftName?.toLowerCase();

    if (giftName === 'heart me') {
      await activateFanStatus(user, nick);
      const { isFan } = await getUserData(user, nick);
      await addBP(user, 0.5, 'GIFT', nick, isFan);
      console.log(`→ Heart Me → FAN ACTIVATED VOOR 24 UUR`);
      return;
    }

    const diamonds = data.diamondCount || 0;
    const giftBP = diamonds * 0.5;
    if (giftBP <= 0) return;

    const { isFan } = await getUserData(user, nick);
    await addBP(user, giftBP, 'GIFT', nick, isFan);
    console.log(`→ ${data.giftName} (${diamonds} diamonds)`);
  });

  // === LIKE, FOLLOW, SHARE – GEEN FAN UPDATE MEER ===
  tiktokLiveConnection.on('like', async (data: any) => {
    const user = data.uniqueId;
    const nick = data.nickname;
    const likes = data.likeCount || 1;

    const current = pendingLikes.get(user) || 0;
    const total = current + likes;
    pendingLikes.set(user, total);

    const fullHundreds = Math.floor(total / 100);
    if (fullHundreds > 0) {
      const { isFan } = await getUserData(user, nick);
      await addBP(user, fullHundreds, 'LIKE', nick, isFan);
      console.log(`→ +${likes} likes → ${fullHundreds}x100`);
      pendingLikes.set(user, total % 100);
    }
  });

  tiktokLiveConnection.on('follow', async (data: any) => {
    const user = data.uniqueId;
    const nick = data.nickname;
    if (hasFollowed.has(user)) return;
    hasFollowed.add(user);

    const { isFan } = await getUserData(user, nick);
    await addBP(user, 5, 'FOLLOW', nick, isFan);
    console.log(`→ eerste follow in deze stream`);
  });

  tiktokLiveConnection.on('share', async (data: any) => {
    const user = data.uniqueId;
    const nick = data.nickname;

    const { isFan } = await getUserData(user, nick);
    await addBP(user, 5, 'SHARE', nick, isFan);
    console.log(`→ stream gedeeld`);
  });

  tiktokLiveConnection.on('connected', () => {
    console.log('Volledig verbonden met TikTok Live!');
  });
}

const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME || 'JOUW_TIKTOK_USERNAME';

initDB().then(() => {
  server.listen(4000, () => {
    console.log('Backend draait op :4000');
    startTikTokLive(TIKTOK_USERNAME);
  });
});
