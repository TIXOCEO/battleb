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

// === NATIVE WEBSOCKET (EULER STREAM) ===
const wsUrl = `wss://ws.eulerstream.com?uniqueId=${TIKTOK_USERNAME}&apiKey=${EULER_API_KEY}`;
let ws: WebSocket;

const currentGuests = new Set<string>(); // Houdt bij wie er nu co-host is

interface UserData {
  isFan: boolean;
  isVip: boolean;
}

async function getUserData(tiktok_id: bigint, display_name: string, username: string): Promise<UserData> {
  const usernameWithAt = '@' + username.toLowerCase();
  const query = `
    INSERT INTO users (tiktok_id, display_name, username, bp_total, is_fan, fan_expires_at, is_vip, vip_expires_at)
    VALUES ($1, $2, $3, 0, false, NULL, false, NULL)
    ON CONFLICT (tiktok_id)
    DO UPDATE SET display_name = EXCLUDED.display_name, username = EXCLUDED.username
    RETURNING bp_total, is_fan, fan_expires_at, is_vip, vip_expires_at;
  `;
  const res = await pool.query(query, [tiktok_id, display_name, usernameWithAt]);
  const row = res.rows[0];
  const isFan = row.is_fan && row.fan_expires_at && new Date(row.fan_expires_at) > new Date();
  const isVip = row.is_vip && row.vip_expires_at && new Date(row.vip_expires_at) > new Date();
  return { isFan, isVip };
}

function connectWebSocket() {
  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log('='.repeat(80));
    console.log('EULER STREAM WEBSOCKET VERBONDEN – MULTI-GUEST TRACKING ACTIEF');
    console.log('='.repeat(80));
  });

  ws.on('message', (data: WebSocket.Data) => {
    const raw = data.toString();
    console.log('RAW WS →', raw.slice(0, 500));

    let events: any[] = [];

    try {
      const payload = JSON.parse(raw);

      if (Array.isArray(payload.messages)) events = payload.messages;
      else if (Array.isArray(payload.data)) events = payload.data;
      else if (Array.isArray(payload.events)) events = payload.events;
      else if (payload.type) events = [payload];

      console.log(`GEPARSED ${events.length} EVENT(S)`);
    } catch (e) {
      console.error('JSON parse fout →', e);
      return;
    }

    events.forEach((msg: any) => {
      const type = msg.type as string;

      // === ALLEEN MULTI-GUEST EVENTS ===
      if (type === 'WebcastLinkMicMethodMessage') {
        const method = msg.data?.common?.method;
        const user = msg.data?.user;

        if (!method || !user) return;

        const userId = (user.userId?.toString() ?? user.uniqueId ?? '??') as string;
        const displayName = user.nickname ?? 'Onbekend';
        const username = user.uniqueId ?? '';

        console.log(`[MULTI-GUEST] ${method} → ${displayName} (@${username})`);

        // --- ACCEPT / JOIN ---
        if (method.includes('permit_join') || method === 'join_linkmic') {
          console.log(`[GUEST ACCEPTED] ${displayName} is nu co-host!`);
          arenaJoin(userId, displayName, username, 'co-host');
          currentGuests.add(userId);
          console.log(`[GUESTS ONLINE] ${currentGuests.size}/8`);
        }

        // --- LEAVE ---
        if (method.includes('leave_linkmic') || method === 'leave') {
          console.log(`[GUEST LEFT] ${displayName} heeft de co-host verlaten`);
          arenaLeave(userId);
          currentGuests.delete(userId);
          console.log(`[GUESTS ONLINE] ${currentGuests.size}/8`);
        }

        // --- KICK ---
        if (method.includes('kick_out')) {
          console.log(`[GUEST KICKED] ${displayName} is verwijderd`);
          arenaLeave(userId);
          currentGuests.delete(userId);
          console.log(`[GUESTS ONLINE] ${currentGuests.size}/8`);
        }

        // --- INVITE ---
        if (method.includes('invite')) {
          console.log(`[GUEST INVITED] ${displayName} is uitgenodigd`);
        }

        return;
      }

      // === LAYOUT CHANGE (extra bewijs van guest) ===
      if (type === 'WebcastLinkLayerMessage') {
        const layout = msg.data?.layout;
        if (layout) {
          console.log(`[LAYOUT CHANGE] ${layout} → waarschijnlijk nieuwe co-host`);
        }
        return;
      }

      // === ALLES ANDERE WORDT GENEGEERD ===
      // console.log(`[IGNORED] ${type}`);
    });
  });

  ws.on('close', (code: number, reason: string) => {
    console.log(`WebSocket gesloten (code ${code}) – herconnect over 5 sec...`);
    currentGuests.clear(); // Reset bij reconnect
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
