// src/server.ts — BATTLEBOX 5-ENGINE – ADMIN DASHBOARD 100% LIVE & CLEAN – 11 NOV 2025 02:10 CET
import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import { initDB } from './db';
import pool from './db';
import cors from 'cors';
import dotenv from 'dotenv';

// ENGINES
import { startConnection } from './engines/1-connection';
import { getOrUpdateUser } from './engines/2-user-engine';
import { initGiftEngine } from './engines/3-gift-engine';
import { addBP } from './engines/4-points-engine';
import { 
  initGame, 
  arenaJoin, 
  arenaLeave, 
  arenaClear, 
  getArena, 
  emitArena 
} from './engines/5-game-engine';
import { addToQueue, getQueue } from './queue';

dotenv.config();

// === FATAL .env CHECKS ===
if (!process.env.TIKTOK_USERNAME) {
  console.error('FATAL: TIKTOK_USERNAME ontbreekt in .env!');
  process.exit(1);
}

// === ADMIN AUTH TOKEN ===
const ADMIN_TOKEN = "supergeheim123";

// === EXPRESS + SOCKET.IO ===
const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);

export const io = new Server(server, { 
  cors: { origin: '*' },
  path: '/socket.io'
});

// === OPEN REST API ===
app.get('/queue', async (req, res) => {
  res.json({ open: true, entries: await getQueue() });
});

app.get('/arena', async (req, res) => {
  res.json(getArena());
});

app.get('/logs', async (req, res) => {
  res.json({ logs: [] });
});

// === ADMIN AUTH MIDDLEWARE ===
const requireAdmin = (req: any, res: any, next: any) => {
  const auth = req.headers.authorization;
  if (auth === `Bearer ${ADMIN_TOKEN}`) return next();
  res.status(401).json({ success: false, message: "Unauthorized" });
};

// === SOCKET.IO AUTH + TYPING FIX ===
interface AdminSocket extends Socket {
  isAdmin?: boolean;
}

io.use((socket: any, next) => {
  const token = socket.handshake.auth?.token;
  if (token === ADMIN_TOKEN) {
    socket.isAdmin = true;
    return next();
  }
  return next(new Error('Authentication error'));
});

// === EMIT HELPERS ===
export function emitQueue() {
  io.emit('updateQueue', { open: true, entries: getQueue() });
}

export function emitLog(log: any) {
  io.emit('log', { 
    id: Date.now().toString(), 
    timestamp: new Date().toISOString(),
    ...log 
  });
}

// === SOCKET CONNECTION ===
io.on('connection', (socket: AdminSocket) => {
  if (!socket.isAdmin) {
    console.log('Unauthenticated socket attempt');
    return socket.disconnect();
  }

  console.log('ADMIN DASHBOARD VERBONDEN:', socket.id);

  socket.emit('updateArena', getArena());
  socket.emit('updateQueue', { open: true, entries: getQueue() });
  emitLog({ type: "system", message: "Admin dashboard verbonden" });

  // === ADMIN ACTIES (simpel – promote/demote via !adm in chat voor nu) ===
  const handleAdminAction = async (action: string, data: any, ack: Function) => {
    try {
      if (!data?.username) {
        return ack({ success: false, message: "username vereist" });
      }

      const username = data.username.trim();
      const userRes = await pool.query(
        'SELECT tiktok_id, display_name, username FROM users WHERE username ILIKE $1',
        [username]
      );

      if (!userRes.rows[0]) {
        return ack({ success: false, message: `Gebruiker @${username} niet gevonden` });
      }

      const { tiktok_id, display_name } = userRes.rows[0];
      const tid = tiktok_id.toString();

      switch (action) {
        case 'addToArena':
          arenaJoin(tid, username, display_name, 'admin');
          emitArena();
          emitLog({ type: "join", message: `@${username} toegevoegd aan arena` });
          break;

        case 'addToQueue':
          await addToQueue(tid, username);
          emitQueue();
          emitLog({ type: "join", message: `@${username} toegevoegd aan wachtrij` });
          break;

        case 'eliminate':
          arenaLeave(tid);
          emitArena();
          emitLog({ type: "elim", message: `@${username} geëlimineerd` });
          break;

        // promote/demote/remove → via !adm chat commando's (werkt al)
        default:
          return ack({ success: false, message: "Actie nog niet via socket – gebruik !adm in chat" });
      }

      ack({ success: true, message: "Actie uitgevoerd" });
    } catch (err: any) {
      console.error('Admin action error:', err);
      ack({ success: false, message: err.message || "Server error" });
    }
  };

  socket.on('admin:addToArena', (d, ack) => handleAdminAction('addToArena', d, ack));
  socket.on('admin:addToQueue', (d, ack) => handleAdminAction('addToQueue', d, ack));
  socket.on('admin:eliminate', (d, ack) => handleAdminAction('eliminate', d, ack));
});

// === ADMIN REST ENDPOINTS (placeholder) ===
app.post('/api/admin/:action', requireAdmin, async (req, res) => {
  res.json({ success: true, message: "REST endpoint klaar – gebruik socket voor live" });
});

// === TEST ENDPOINTS ===
app.post('/admin/test/add-random-player', requireAdmin, (req, res) => {
  const fakeId = Date.now().toString();
  const name = `test_${fakeId.slice(-4)}`;
  arenaJoin(fakeId, name, `TestPlayer${fakeId.slice(-4)}`, 'admin'); // 'admin' is toegestaan
  emitArena();
  emitLog({ type: "test", message: `Random speler ${name} toegevoegd` });
  res.json({ success: true });
});

app.post('/admin/test/log', requireAdmin, (req, res) => {
  emitLog({ type: "gift", message: "TEST: 500 diamonds van @admin" });
  res.json({ success: true });
});

// === GLOBALS ===
const ADMIN_ID = process.env.ADMIN_TIKTOK_ID?.trim();
let conn: any = null;

// === START SERVER ===
initDB().then(async () => {
  server.listen(4000, () => {
    console.log('BATTLEBOX 5-ENGINE + ADMIN DASHBOARD LIVE → http://localhost:4000');
    console.log('='.repeat(80));
  });

  initGame();

  const { conn: tikTokConn } = await startConnection(
    process.env.TIKTOK_USERNAME!,
    () => {}
  );

  conn = tikTokConn;
  initGiftEngine(conn);

  // === CHAT + ADMIN COMMANDS (WERKT AL) ===
  conn.on('chat', async (data: any) => {
    const msg = (data.comment || '').trim();
    if (!msg) return;

    const userId = BigInt(data.userId || '0');
    const user = await getOrUpdateUser(userId.toString(), data.nickname, data.uniqueId);

    console.log(`[CHAT] ${user.display_name}: ${msg}`);
    await addBP(userId, 1, 'CHAT', user.display_name);

    if (userId.toString() === ADMIN_ID && msg.toLowerCase().startsWith('!adm voegrij @')) {
      const target = msg.split('@')[1]?.split(' ')[0];
      if (target) {
        const res = await pool.query('SELECT tiktok_id FROM users WHERE username ILIKE $1', [`%@${target}`]);
        if (res.rows[0]) {
          await addToQueue(res.rows[0].tiktok_id, target);
          emitQueue();
          console.log(`[ADMIN] ${target} toegevoegd aan queue`);
        }
      }
    }
  });

  // === LIKE / FOLLOW / SHARE ===
  const pendingLikes = new Map<string, number>();
  const hasFollowed = new Set<string>();

  conn.on('like', async (data: any) => {
    const userId = (data.userId || '0').toString();
    if (userId === '0') return;
    const prev = pendingLikes.get(userId) || 0;
    const total = prev + (data.likeCount || 1);
    const bp = Math.floor(total / 100) - Math.floor(prev / 100);
    if (bp > 0) {
      const user = await getOrUpdateUser(userId, data.nickname, data.uniqueId);
      await addBP(BigInt(userId), bp, 'LIKE', user.display_name);
    }
    pendingLikes.set(userId, total);
  });

  conn.on('follow', async (data: any) => {
    const userId = (data.userId || '0').toString();
    if (userId === '0' || hasFollowed.has(userId)) return;
    hasFollowed.add(userId);
    const user = await getOrUpdateUser(userId, data.nickname, data.uniqueId);
    await addBP(BigInt(userId), 5, 'FOLLOW', user.display_name);
  });

  conn.on('share', async (data: any) => {
    const userId = (data.userId || '0').toString();
    if (userId === '0') return;
    const user = await getOrUpdateUser(userId, data.nickname, data.uniqueId);
    await addBP(BigInt(userId), 5, 'SHARE', user.display_name);
  });

  // === GUEST IN/UIT ARENA ===
  conn.on('liveRoomGuestEnter', async (data: any) => {
    const userId = (data.user?.userId || '0').toString();
    if (userId === '0') return;
    const user = await getOrUpdateUser(userId, data.user?.nickname, data.user?.uniqueId);
    arenaJoin(userId, user.display_name, user.username, 'guest');
    console.log(`[JOIN] ${user.display_name} → ARENA`);
    emitArena();
  });

  conn.on('liveRoomGuestLeave', (data: any) => {
    const userId = (data.user?.userId || '0').toString();
    if (userId === '0') return;
    arenaLeave(userId);
    emitArena();
  });

  conn.on('liveEnd', () => {
    console.log('[LIVE END] Alles gereset');
    arenaClear();
    emitArena();
  });
});
