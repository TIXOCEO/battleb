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

// === UPDATE FAN STATUS (alleen bij betrouwbare events) ===
async function updateFanStatus(tiktok_id: string, isFan: boolean) {
  await pool.query('UPDATE users SET is_fan = $1 WHERE tiktok_id = $2', [isFan, tiktok_id]);
}

// === HAAL USER + FAN STATUS OP – 100% ZONDER DUPLICATE ERRORS ===
async function getUserData(tiktok_id: string, username: string) {
  const query = `
    INSERT INTO users (tiktok_id, username, bp_total, is_fan)
    VALUES ($1, $2, 0, false)
    ON CONFLICT (tiktok_id) 
    DO UPDATE SET username = EXCLUDED.username
    RETURNING bp_total, is_fan;
  `;

  try {
    const res = await pool.query(query, [tiktok_id, username]);
    const row = res.rows[0];

    if (res.rowCount === 1 && !row) {
      console.log(`[NEW USER] @${username}`);
      return { oldBP: 0, isFan: false };
    }

    return {
      oldBP: parseFloat(row.bp_total) || 0,
      isFan: row.is_fan === true
    };
  } catch (err: any) {
    if (err.code === '23505') {
      console.log(`[DUPLICATE FIX] @${username} – retrying...`);
      const res = await pool.query('SELECT bp_total, is_fan FROM users WHERE tiktok_id = $1', [tiktok_id]);
      return {
        oldBP: parseFloat(res.rows[0].bp_total) || 0,
        isFan: res.rows[0].is_fan === true
      };
    }
    throw err;
  }
}

// === BP TOEVOEGEN + LOG MET [FAN] ===
async function addBP(tiktok_id: string, amount: number, action: string, nick: string, isFan: boolean) {
  const oldBP = (await pool.query('SELECT bp_total FROM users WHERE tiktok_id = $1', [tiktok_id])).rows[0]?.bp_total || 0;

  await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [amount, tiktok_id]);

  const newBP = (await pool.query('SELECT bp_total FROM users WHERE tiktok_id = $1', [tiktok_id])).rows[0].bp_total;

  const fanTag = isFan ? ' [FAN]' : '';
  console.log(`[${action}] @${nick}${fanTag}`);
  console.log(`[BP: +${amount} | ${parseFloat(oldBP).toFixed(1)} → ${parseFloat(newBP).toFixed(1)}]`);
}

async function startTikTokLive(username: string) {
  const tiktokLiveConnection = new WebcastPushConnection(username);

  tiktokLiveConnection.connect().then(state => {
    console.info(`Verbonden met roomId ${state.roomId}`);
  }).catch(err => {
    console.error('Failed to connect to TikTok Live:', err);
  });

  // === CHAT – GEBRUIK DB VOOR [FAN] ===
  tiktokLiveConnection.on('chat', async (data: any) => {
    const rawComment = data.comment || '';
    const msg = rawComment.toLowerCase().trim();
    if (!msg) return;

    console.log(`[CHAT] Raw: "${rawComment}" → Parsed: "${msg}" (user: @${data.nickname})`);

    const user = data.uniqueId;
    const nick = data.nickname;

    const { oldBP, isFan } = await getUserData(user, nick);
    await addBP(user, 1, 'CHAT', nick, isFan);

    // === COMMANDOS (GEFIXT – GEEN && MEER) ===
    if (msg === '!join') {
      console.log(`!join ontvangen van @${nick}`);
      try {
        await addToQueue(user, nick);
        emitQueue();
      } catch (e: any) {
        console.log('Join error:', e.message);
      }
    } else if (msg.startsWith('!boost rij ')) {
      const spots = parseInt(msg.split(' ')[2] || '0');
      if (spots >= 1 && spots <= 5) {
        console.log(`!boost rij ${spots} van @${nick}`);
        try {
          await boostQueue(user, spots);
          emitQueue();
        } catch (e: any) {
          console.log('Boost error:', e.message);
        }
      }
    } else if (msg === '!leave') {
      console.log(`!leave ontvangen van @${nick}`);
      try {
        const refund = await leaveQueue(user);
        if (refund > 0) console.log(`@${nick} kreeg ${refund} BP terug`);
        emitQueue();
      } catch (e: any) {
        console.log('Leave error:', e.message);
      }
    }
  });

  // === GIFT, LIKE, FOLLOW, SHARE → UPDATE FAN STATUS + BP ===
  tiktokLiveConnection.on('gift', async (data: any) => {
    const user = data.uniqueId;
    const nick = data.nickname;
    const diamonds = data.diamondCount || 0;
    const giftBP = diamonds * 0.5;
    if (giftBP <= 0) return;

    // Update fan status
    const isFan = data.isFanClubMember === true;
    await updateFanStatus(user, isFan);

    const { isFan: currentFan } = await getUserData(user, nick);
    await addBP(user, giftBP, 'GIFT', nick, currentFan);
    console.log(`→ ${data.giftName} (${diamonds} diamonds)`);
  });

  tiktokLiveConnection.on('like', async (data: any) => {
    const user = data.uniqueId;
    const nick = data.nickname;
    const likes = data.likeCount || 1;

    const isFan = data.isFanClubMember === true;
    await updateFanStatus(user, isFan);

    const current = pendingLikes.get(user) || 0;
    const total = current + likes;
    pendingLikes.set(user, total);

    const fullHundreds = Math.floor(total / 100);
    if (fullHundreds > 0) {
      const { isFan: currentFan } = await getUserData(user, nick);
      await addBP(user, fullHundreds, 'LIKE', nick, currentFan);
      console.log(`→ +${likes} likes → ${fullHundreds}x100 (totaal: ${total})`);
      pendingLikes.set(user, total % 100);
    }
  });

  tiktokLiveConnection.on('follow', async (data: any) => {
    const user = data.uniqueId;
    const nick = data.nickname;
    if (hasFollowed.has(user)) return;
    hasFollowed.add(user);

    const isFan = data.isFanClubMember === true;
    await updateFanStatus(user, isFan);

    const { isFan: currentFan } = await getUserData(user, nick);
    await addBP(user, 5, 'FOLLOW', nick, currentFan);
    console.log(`→ eerste follow in deze stream`);
  });

  tiktokLiveConnection.on('share', async (data: any) => {
    const user = data.uniqueId;
    const nick = data.nickname;

    const isFan = data.isFanClubMember === true;
    await updateFanStatus(user, isFan);

    const { isFan: currentFan } = await getUserData(user, nick);
    await addBP(user, 5, 'SHARE', nick, currentFan);
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
