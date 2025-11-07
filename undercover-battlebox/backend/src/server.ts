// backend/src/server.ts
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import WebSocket from 'ws';
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
  require('./queue').emitQueue();
  require('./game').emitArena();
});

const ADMIN_ID = process.env.ADMIN_TIKTOK_ID?.trim();
const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME?.trim()?.replace('@', '') || 'JOUW_USERNAME';
const EULER_API_KEY = process.env.EULER_API_KEY?.trim();

if (!EULER_API_KEY) {
  console.error('ERROR: Voeg EULER_API_KEY toe aan je .env!');
  process.exit(1);
}

// === WEBSOCKET ===
const wsUrl = `wss://ws.eulerstream.com?uniqueId=${TIKTOK_USERNAME}&apiKey=${EULER_API_KEY}`;
let ws: WebSocket;

// Houd bij wie er nu co-host is
const currentGuests = new Set<string>();

function connectWebSocket() {
  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log('='.repeat(80));
    console.log('EULER WEBSOCKET VERBONDEN – ALLEEN ECHTE CO-HOST EVENTS');
    console.log('='.repeat(80));
  });

  ws.on('message', (data: WebSocket.Data) => {
    const raw = data.toString();

    let events: any[] = [];

    try {
      const payload = JSON.parse(raw);
      if (Array.isArray(payload.messages)) events = payload.messages;
      else if (Array.isArray(payload.data)) events = payload.data;
      else if (Array.isArray(payload.events)) events = payload.events;
      else if (payload.type) events = [payload];
    } catch (e) {
      return;
    }

    events.forEach((msg: any) => {
      const type = msg.type as string;

      // === ALLEEN ECHTE CO-HOST EVENTS ===
      if (type === 'WebcastLinkMicMethodMessage') {
        const method = msg.data?.common?.method;
        const user = msg.data?.user;

        if (!method || !user) return;

        const userId = (user.userId?.toString() ?? user.uniqueId ?? '??') as string;
        const displayName = user.nickname ?? 'Onbekend';
        const username = user.uniqueId ?? '';

        // --- LOG ALLEEN BELANGRIJKE ACTIES ---
        if (method.includes('permit_join') || method === 'join_linkmic') {
          console.log(`\n[GUEST ACCEPTED] ${displayName} (@${username}) is nu co-host!`);
          arenaJoin(userId, displayName, username, 'co-host');
          currentGuests.add(userId);
          console.log(`[GUESTS ONLINE] ${currentGuests.size}/8\n`);
        }

        else if (method.includes('leave_linkmic') || method.includes('leave')) {
          console.log(`\n[GUEST LEFT] ${displayName} (@${username}) heeft de co-host verlaten`);
          arenaLeave(userId);
          currentGuests.delete(userId);
          console.log(`[GUESTS ONLINE] ${currentGuests.size}/8\n`);
        }

        else if (method.includes('kick_out')) {
          console.log(`\n[GUEST KICKED] ${displayName} (@${username}) is verwijderd`);
          arenaLeave(userId);
          currentGuests.delete(userId);
          console.log(`[GUESTS ONLINE] ${currentGuests.size}/8\n`);
        }

        else if (method.includes('invite')) {
          console.log(`\n[GUEST INVITED] ${displayName} (@${username}) is uitgenodigd\n`);
        }

        // Debug: toon alle methodes (optioneel, verwijder later)
        else {
          console.log(`[DEBUG METHOD] ${method} → ${displayName}`);
        }
      }

      // === ALLES ANDERE WORDT GENEGEERD (geen layout, geen like, geen chat) ===
    });
  });

  ws.on('close', (code: number) => {
    console.log(`WebSocket gesloten (code ${code}) – herconnect over 5 sec...`);
    currentGuests.clear();
    setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', (err: Error) => {
    console.error('WebSocket error:', err);
  });
}

// === START ===
initDB()
  .then(() => {
    server.listen(4000, () => {
      console.log('BATTLEBOX BACKEND LIVE → http://localhost:4000');
      console.log('='.repeat(80));
      connectWebSocket();
    });
  })
  .catch((err) => {
    console.error('DB initialisatie mislukt:', err);
    process.exit(1);
  });
