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

// ─────────────────────────────────────────────────────────────────────────────
// 1. INITIALISATIE: Express + Socket.IO + .env
// ─────────────────────────────────────────────────────────────────────────────
dotenv.config();

const app = express();
app.use(cors()); // Sta verbindingen toe vanaf frontend (bijv. localhost:3000)
const server = http.createServer(app);
export const io = new Server(server, { cors: { origin: '*' } });

// Start de battlebox arena (BP, grid, etc.)
initGame(io);

// API endpoints voor frontend
app.get('/queue', async (req, res) => {
  const queue = await getQueue();
  res.json(queue);
});

app.get('/arena', async (req, res) => {
  res.json(getArena());
});

// Stuur updates naar alle verbonden dashboards
io.on('connection', (socket) => {
  console.log('Dashboard verbonden:', socket.id);
  require('./queue').emitQueue();
  require('./game').emitArena();
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. CONFIGURATIE: TikTok username + Euler API key
// ─────────────────────────────────────────────────────────────────────────────
const ADMIN_ID = process.env.ADMIN_TIKTOK_ID?.trim();
const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME?.trim()?.replace('@', '') || 'JOUW_USERNAME';
const EULER_API_KEY = process.env.EULER_API_KEY?.trim();

if (!EULER_API_KEY) {
  console.error('ERROR: Voeg EULER_API_KEY toe aan je .env!');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. WEBSOCKET: Verbinding met EulerStream (TikTok Live data)
// ─────────────────────────────────────────────────────────────────────────────
const wsUrl = `wss://ws.eulerstream.com?uniqueId=${TIKTOK_USERNAME}&apiKey=${EULER_API_KEY}`;
let ws: WebSocket;

// Houd bij wie er momenteel co-host is (max 8)
const currentGuests = new Set<string>();

function connectWebSocket() {
  ws = new WebSocket(wsUrl);

  // ── Verbonden met Euler ───────────────────────────────────────────────────
  ws.on('open', () => {
    console.log('='.repeat(80));
    console.log('EULER WEBSOCKET VERBONDEN – ALLEEN CO-HOST EVENTS');
    console.log('='.repeat(80));
  });

  // ── Ontvang berichten van TikTok Live (via Euler) ───────────────────────
  ws.on('message', (data: WebSocket.Data) => {
    const raw = data.toString();

    let events: any[] = [];

    // Euler stuurt JSON met: messages[], data[], events[] of enkel type
    try {
      const payload = JSON.parse(raw);
      if (Array.isArray(payload.messages)) events = payload.messages;
      else if (Array.isArray(payload.data)) events = payload.data;
      else if (Array.isArray(payload.events)) events = payload.events;
      else if (payload.type) events = [payload];
    } catch (e) {
      return; // Geen JSON → negeer
    }

    // ── Loop door alle events ─────────────────────────────────────────────
    events.forEach((msg: any) => {
      const type = msg.type as string;

      // DEBUG: Toon elk event met 'link' of 'mic' in de naam
      if (type.toLowerCase().includes('link') || type.toLowerCase().includes('mic')) {
        console.log(`[DEBUG TYPE] ${type}`);
      }

      // ── ALLEEN ECHTE CO-HOST EVENTS (WebcastLinkMicMethodMessage) ───────
      if (type === 'WebcastLinkMicMethodMessage') {
        const method = msg.data?.common?.method;
        const user = msg.data?.user;

        if (!method || !user) return;

        const userId = (user.userId?.toString() ?? user.uniqueId ?? '??') as string;
        const displayName = user.nickname ?? 'Onbekend';
        const username = user.uniqueId ?? '';

        // ── LOG: Duidelijk wat er gebeurt ───────────────────────────────
        console.log(`\n[MULTI-GUEST] ${method}`);
        console.log(`→ ${displayName} (@${username})\n`);

        // ── 1. Gast accepteert uitnodiging → wordt co-host ─────────────
        if (method.includes('permit_join') || method === 'join_linkmic') {
          console.log(`[GUEST ACCEPTED] ${displayName} is nu co-host!`);
          arenaJoin(userId, displayName, username, 'co-host');
          currentGuests.add(userId);
          console.log(`[GUESTS ONLINE] ${currentGuests.size}/8\n`);
        }

        // ── 2. Gast verlaat (vrijwillig of timeout) ───────────────────
        else if (method.includes('leave_linkmic') || method.includes('leave')) {
          console.log(`[GUEST LEFT] ${displayName} heeft de co-host verlaten`);
          arenaLeave(userId);
          currentGuests.delete(userId);
          console.log(`[GUESTS ONLINE] ${currentGuests.size}/8\n`);
        }

        // ── 3. Host kickt gast ───────────────────────────────────────
        else if (method.includes('kick_out')) {
          console.log(`[GUEST KICKED] ${displayName} is verwijderd`);
          arenaLeave(userId);
          currentGuests.delete(userId);
          console.log(`[GUESTS ONLINE] ${currentGuests.size}/8\n`);
        }

        // ── 4. Host nodigt gast uit ───────────────────────────────────
        else if (method.includes('invite')) {
          console.log(`[GUEST INVITED] ${displayName} is uitgenodigd\n`);
        }

        // ── 5. Onbekende methode (debug) ─────────────────────────────
        else {
          console.log(`[DEBUG METHOD] ${method} → ${displayName}\n`);
        }
      }

      // ── ALLES ANDERE WORDT GENEGEERD (geen layout, geen likes, etc.) ──
    });
  });

  // ── Verbinding verbroken → probeer opnieuw na 5 sec ───────────────────
  ws.on('close', (code: number) => {
    console.log(`WebSocket gesloten (code ${code}) – herconnect over 5 sec...`);
    currentGuests.clear(); // Reset gasten bij reconnect
    setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', (err: Error) => {
    console.error('WebSocket fout:', err);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. START SERVER + DATABASE
// ─────────────────────────────────────────────────────────────────────────────
initDB()
  .then(() => {
    server.listen(4000, () => {
      console.log('BATTLEBOX BACKEND LIVE → http://localhost:4000');
      console.log('='.repeat(80));
      connectWebSocket(); // Start WebSocket na server start
    });
  })
  .catch((err) => {
    console.error('DB initialisatie mislukt:', err);
    process.exit(1);
  });
