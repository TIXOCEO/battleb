// backend/src/server.ts (volledige bijgewerkte versie)
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { WebcastPushConnection } from 'tiktok-live-connector';  // ← Correcte import
import { initDB } from './db';
import { addToQueue, getQueue } from './queue';
import { User, QueueEntry } from './types';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();  // ← Voeg dit toe voor .env support

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
  io.emit('queue:update', queue.slice(0, 50)); // max 50
}

// Start TikTok Live (bijgewerkt voor WebcastPushConnection)
async function startTikTokLive(username: string) {
  const tiktokLiveConnection = new WebcastPushConnection(username);
  
  tiktokLiveConnection.connect().then(state => {
    console.info(`Verbonden met roomId ${state.roomId}`);
  }).catch(err => {
    console.error('Failed to connect to TikTok Live:', err);
  });
  
  tiktokLiveConnection.on('chat', async (data: any) => {
    const msg = data.comment.toLowerCase();
    const user = data.uniqueId;
    const nick = data.nickname;

    if (msg === '!join') {
      try {
        await addToQueue(user, nick);
        emitQueue();
        console.log(`@${nick} joined queue!`);
      } catch (e) { 
        console.log('Queue error:', e); 
      }
    }
    // !boost, !leave later
  });

  tiktokLiveConnection.on('gift', (data: any) => {
    console.log('Gift ontvangen:', data.nickname, data.giftName, data.diamondCount);
    // BP + points later
  });

  tiktokLiveConnection.on('connected', () => {
    console.log('Volledig verbonden met TikTok Live!');
  });
}

// === START ===
const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME || 'JOUW_TIKTOK_USERNAME';  // ← Gebruik .env

initDB().then(() => {
  server.listen(4000, () => {
    console.log('Backend draait op :4000');
    startTikTokLive(TIKTOK_USERNAME);
  });
});
