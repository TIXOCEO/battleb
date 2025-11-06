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
const io = new Server(server, {
  cors: { origin: '*' }
});

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

// === STATE VOOR DEZE STREAM ===
const hasFollowed = new Set<string>(); // user → al gefollowd in deze stream

async function startTikTokLive(username: string) {
  const tiktokLiveConnection = new WebcastPushConnection(username);

  tiktokLiveConnection.connect().then(state => {
    console.info(`Verbonden met roomId ${state.roomId}`);
  }).catch(err => {
    console.error('Failed to connect to TikTok Live:', err);
  });

  // === CHAT HANDLER ===
  tiktokLiveConnection.on('chat', async (data: any) => {
    const rawComment = data.comment;
    const msg = rawComment ? String(rawComment).toLowerCase().trim() : '';

    console.log(`[CHAT] Raw: "${rawComment}" → Parsed: "${msg}" (user: @${data.nickname})`);

    if (!msg) return;

    const user = data.uniqueId;
    const nick = data.nickname;

    // === BADGE DETECTIE ===
    const badges: string[] = [];
    if (data.isSuperFan === true) badges.push('superfan');
    if (data.isFanClubMember === true) badges.push('fanclub'); // ← Automatisch voor custom 'Meow'
    if (data.isVip === true) badges.push('vip');

    // === USER CHECK + NEW USER ===
    let isNewUser = false;
    let oldBP = 0;

    const userCheck = await pool.query('SELECT bp_total FROM users WHERE tiktok_id = $1', [user]);
    if (userCheck.rows.length === 0) {
      isNewUser = true;
      console.log(`[NEW USER] @${nick}`);
    } else {
      oldBP = parseFloat(userCheck.rows[0].bp_total) || 0;
    }

    // === UPDATE USER ===
    try {
      await pool.query(
        `INSERT INTO users (tiktok_id, username, badges, bp_total) 
         VALUES ($1, $2, $3, 0) 
         ON CONFLICT (tiktok_id) DO UPDATE SET 
           username = EXCLUDED.username,
           badges = EXCLUDED.badges`,
        [user, nick, badges]
      );
    } catch (e) {
      console.log('User update error:', e);
    }

    // === BP VOOR CHAT: +1 ===
    const chatBP = 1;
    await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [chatBP, user]);

    // Query NA update voor correcte newBP
    const res = await pool.query('SELECT bp_total FROM users WHERE tiktok_id = $1', [user]);
    const newBP = parseFloat(res.rows[0]?.bp_total) || 0;

    // === LOGS ===
    if (badges.length > 0) console.log(`[BADGES: ${badges.join(', ')}]`); // ← Nu altijd getoond
    console.log(`[BP: +${chatBP} | ${newBP.toFixed(1)}]`);

    // === COMMANDOS ===
    if (msg === '!join') {
      console.log(`!join ontvangen van @${nick}`);
      try {
        await addToQueue(user, nick);
        emitQueue();
      } catch (e: any) {
        console.log('Join error:', e.message);
      }
    }

    else if (msg.startsWith('!boost rij ')) {
      const parts = msg.split(' ');
      const spots = parseInt(parts[2] || '0');
      if (spots >= 1 && spots <= 5) {
        console.log(`!boost rij ${spots} van @${nick}`);
        try {
          await boostQueue(user, spots);
          emitQueue();
        } catch (e: any) {
          console.log('Boost error:', e.message);
        }
      }
    }

    else if (msg === '!leave') {
      console.log(`!leave ontvangen van @${nick}`);
      try {
        const refund = await leaveQueue(user);
        if (refund > 0) {
          console.log(`@${nick} kreeg ${refund} BP terug`);
        }
        emitQueue();
      } catch (e: any) {
        console.log('Leave error:', e.message);
      }
    }
  });

  // === GIFTS – 50% BP ===
  tiktokLiveConnection.on('gift', async (data: any) => {
    const diamonds = data.diamondCount || 0;
    const giftBP = diamonds * 0.5;
    const user = data.uniqueId;

    if (giftBP > 0) {
      await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [giftBP, user]);

      const res = await pool.query('SELECT bp_total FROM users WHERE tiktok_id = $1', [user]);
      const totalBP = parseFloat(res.rows[0]?.bp_total) || 0;

      console.log(`[GIFT] @${data.nickname} → ${data.giftName} (${diamonds} diamonds)`);
      console.log(`[BP: +${giftBP} | ${totalBP.toFixed(1)}]`);
    }
  });

  // === FOLLOW – +5 BP (alleen eerste keer per stream) ===
  tiktokLiveConnection.on('follow', async (data: any) => {
    const user = data.uniqueId;
    const nick = data.nickname;

    if (hasFollowed.has(user)) return;
    hasFollowed.add(user);

    const followBP = 5;
    await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [followBP, user]);

    const res = await pool.query('SELECT bp_total FROM users WHERE tiktok_id = $1', [user]);
    const totalBP = parseFloat(res.rows[0]?.bp_total) || 0;

    console.log(`[FOLLOW] @${nick} → eerste follow in deze stream`);
    console.log(`[BP: +${followBP} | ${totalBP.toFixed(1)}]`); // ← Query NA update
  });

  // === SHARE – +5 BP (elke keer) ===
  tiktokLiveConnection.on('share', async (data: any) => {
    const user = data.uniqueId;
    const nick = data.nickname;

    const shareBP = 5;
    await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [shareBP, user]);

    const res = await pool.query('SELECT bp_total FROM users WHERE tiktok_id = $1', [user]);
    const totalBP = parseFloat(res.rows[0]?.bp_total) || 0;

    console.log(`[SHARE] @${nick} → stream gedeeld`);
    console.log(`[BP: +${shareBP} | ${totalBP.toFixed(1)}]`); // ← Query NA update
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
