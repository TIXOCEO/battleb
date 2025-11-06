// backend/src/server.ts
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { WebcastPushConnection } from 'tiktok-live-connector';
import { initDB } from './db';
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

// API endpoint
app.get('/queue', async (req, res) => {
  const queue = await getQueue();
  res.json(queue);
});

// Socket.io connection
io.on('connection', (socket) => {
  console.log('Overlay connected:', socket.id);
  emitQueue();
});

async function emitQueue() {
  const queue = await getQueue();
  io.emit('queue:update', queue.slice(0, 50));
}

// Start TikTok Live
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
    const msg = rawComment 
      ? String(rawComment).toLowerCase().trim() 
      : '';

    console.log(`[CHAT] Raw: "${rawComment}" → Parsed: "${msg}" (user: @${data.nickname})`);

    if (!msg) return;

    const user = data.uniqueId;
    const nick = data.nickname;

    // === BADGE DETECTIE ===
    const badges: string[] = [];
    if (data.isSuperFan === true) badges.push('superfan');
    if (data.isFanClubMember === true) badges.push('fanclub'); // ← CORRECT
    if (data.isVip === true) badges.push('vip');

    try {
      await pool.query(
        `INSERT INTO users (tiktok_id, username, badges) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (tiktok_id) DO UPDATE SET badges = $3`,
        [user, nick, badges]
      );
    } catch (e) {
      console.log('Badge update error:', e);
    }

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
      } else {
        console.log(`Ongeldige boost: ${spots} (moet 1-5 zijn)`);
      }
    }

    else if (msg === '!leave') {
      console.log(`!leave ontvangen van @${nick}`);
      try {
        const refund = await leaveQueue(user);
        if (refund > 0) {
          console.log(`@${nick} kreeg ${refund} BP terug`);
        } else {
          console.log(`@${nick} had geen boost → geen refund`);
        }
        emitQueue();
      } catch (e: any) {
        console.log('Leave error:', e.message);
      }
    }
  });

  // === GIFTS (OPTIONEEL – LATER BP) ===
  tiktokLiveConnection.on('gift', (data: any) => {
    console.log('Gift ontvangen:', data.nickname, data.giftName, data.diamondCount);
  });

  tiktokLiveConnection.on('connected', () => {
    console.log('Volledig verbonden met TikTok Live!');
  });
}

// === START SERVER ===
const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME || 'JOUW_TIKTOK_USERNAME';

initDB().then(() => {
  server.listen(4000, () => {
    console.log('Backend draait op :4000');
    startTikTokLive(TIKTOK_USERNAME);
  });
});
