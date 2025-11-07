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

// === NATIVE WEBSOCKET (DIT IS DE ECHTE 2025 METHODE) ===
const wsUrl = `wss://ws.eulerstream.com?uniqueId=${TIKTOK_USERNAME}&apiKey=${EULER_API_KEY}`;
let ws: WebSocket;

const pendingLikes = new Map<string, number>();
const hasFollowed = new Set<string>();

async function getUserData(tiktok_id: bigint, display_name: string, username: string) {
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
    console.log('EULER STREAM WEBSOCKET VERBONDEN – MULTI-GUEST 100% WERKENDE');
    console.log('='.repeat(80));
  });

  ws.on('message', (data) => {
    try {
      const payload = JSON.parse(data.toString());
      if (!payload.messages) return;

      payload.messages.forEach((msg: any) => {
        const type = msg.type;

        // === MULTI-GUEST JOIN / LEAVE ===
        if (type === 'member') {
          if (msg.user.isHost) return;
          const userId = msg.user.userId?.toString() || msg.user.uniqueId;
          const display_name = msg.user.nickname || 'Onbekend';
          const tikTokUsername = msg.user.uniqueId;

          if (msg.action === 'join') {
            console.log(`[JOIN] ${display_name} (@${tikTokUsername}) → ULTI-GUEST`);
            arenaJoin(userId, display_name, tikTokUsername, 'guest');
          }
          if (msg.action === 'leave') {
            console.log(`[LEAVE] ${display_name} → verlaat arena`);
            arenaLeave(userId);
          }
        }

        // === CHAT + ADMIN COMMANDS ===
        if (type === 'chat') {
          const rawComment = msg.message || '';
          const messageText = rawComment.trim();
          if (!messageText) return;

          const userId = BigInt(msg.user.userId || '0');
          const display_name = msg.user.nickname || 'Onbekend';
          const tikTokUsername = msg.user.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
          const isAdmin = userId.toString() === ADMIN_ID;

          console.log(`[CHAT] ${display_name}: ${rawComment}`);

          (async () => {
            const { isFan, isVip } = await getUserData(userId, display_name, tikTokUsername);
            await addBP(userId, 1, 'CHAT', display_name, isFan, isVip);
          })();

          if (!isAdmin || !messageText.toLowerCase().startsWith('!adm ')) return;

          // === JOUW ADMIN COMMANDS (100% ongewijzigd) ===
          const args = messageText.slice(5).trim().split(' ');
          const cmd = args[0]?.toLowerCase();
          const rawUsername = args[1];
          if (!rawUsername?.startsWith('@')) return;

          (async () => {
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
              case 'geef':
                const giveAmount = parseFloat(args[2]);
                if (!isNaN(giveAmount) && giveAmount > 0) {
                  await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [giveAmount, targetId]);
                  console.log(`[ADMIN] +${giveAmount} BP → ${rawUsername}`);
                }
                break;
              case 'verw':
                const takeAmount = parseFloat(args[2]);
                if (!isNaN(takeAmount) && takeAmount > 0) {
                  await pool.query('UPDATE users SET bp_total = GREATEST(bp_total - $1, 0) WHERE tiktok_id = $2', [takeAmount, targetId]);
                  console.log(`[ADMIN] -${takeAmount} BP → ${rawUsername}`);
                }
                break;
              case 'voegrij':
                await addToQueue(targetId.toString(), targetDisplay);
                require('./queue').emitQueue();
                console.log(`[ADMIN] ${rawUsername} → wachtrij`);
                break;
              case 'verwrij':
                const refund = await leaveQueue(targetId.toString());
                if (refund > 0) {
                  const half = Math.floor(refund * 0.5);
                  await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [half, targetId]);
                  console.log(`[ADMIN] ${rawUsername} verwijderd → +${half} BP refund`);
                }
                require('./queue').emitQueue();
                break;
              case 'geefvip':
                await pool.query('UPDATE users SET is_vip = true, vip_expires_at = NOW() + INTERVAL \'30 days\' WHERE tiktok_id = $1', [targetId]);
                console.log(`[ADMIN] VIP 30 dagen → ${rawUsername}`);
                break;
              case 'verwvip':
                await pool.query('UPDATE users SET is_vip = false, vip_expires_at = NULL WHERE tiktok_id = $1', [targetId]);
                console.log(`[ADMIN] VIP verwijderd → ${rawUsername}`);
                break;
            }
          })();
        }

        // === GIFT ===
        if (type === 'gift') {
          const userId = BigInt(msg.user.userId || '0');
          const display_name = msg.user.nickname || 'Onbekend';
          const tikTokUsername = msg.user.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
          const giftName = (msg.gift.name || '').toLowerCase();

          (async () => {
            if (giftName.includes('heart me')) {
              await pool.query(
                `INSERT INTO users (tiktok_id, display_name, username, is_fan, fan_expires_at)
                 VALUES ($1, $2, $3, true, NOW() + INTERVAL '24 hours')
                 ON CONFLICT (tiktok_id) DO UPDATE SET is_fan = true, fan_expires_at = NOW() + INTERVAL '24 hours'`,
                [userId, display_name, '@' + tikTokUsername]
              );
              const { isFan, isVip } = await getUserData(userId, display_name, tikTokUsername);
              await addBP(userId, 0.5, 'GIFT', display_name, isFan, isVip);
              console.log(`Heart Me → FAN 24u (${display_name})`);
              return;
            }

            const diamonds = msg.gift.diamondCount || 0;
            const bp = diamonds * 0.5;
            if (bp <= 0) return;

            const { isFan, isVip } = await getUserData(userId, display_name, tikTokUsername);
            await addBP(userId, bp, 'GIFT', display_name, isFan, isVip);
            console.log(`${msg.gift.name} (${diamonds} diamonds) → +${bp} BP`);
          })();
        }

        // === LIKE (batch) ===
        if (type === 'like') {
          const userId = BigInt(msg.user.userId || '0');
          const display_name = msg.user.nickname || 'Onbekend';
          const tikTokUsername = msg.user.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');

          const batch = msg.likeCount || 1;
          const prev = pendingLikes.get(userId.toString()) || 0;
          const total = prev + batch;
          const bp = Math.floor(total / 100) - Math.floor(prev / 100);

          if (bp > 0) {
            (async () => {
              const { isFan, isVip } = await getUserData(userId, display_name, tikTokUsername);
              await addBP(userId, bp, 'LIKE', display_name, isFan, isVip);
            })();
          }
          pendingLikes.set(userId.toString(), total);
        }

        // === FOLLOW & SHARE ===
        if (type === 'follow') {
          const userId = BigInt(msg.user.userId || '0');
          if (hasFollowed.has(userId.toString())) return;
          hasFollowed.add(userId.toString());
          const display_name = msg.user.nickname || 'Onbekend';
          const tikTokUsername = msg.user.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');

          (async () => {
            const { isFan, isVip } = await getUserData(userId, display_name, tikTokUsername);
            await addBP(userId, 5, 'FOLLOW', display_name, isFan, isVip);
          })();
        }

        if (type === 'share') {
          const userId = BigInt(msg.user.userId || '0');
          const display_name = msg.user.nickname || 'Onbekend';
          const tikTokUsername = msg.user.uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '');

          (async () => {
            const { isFan, isVip } = await getUserData(userId, display_name, tikTokUsername);
            await addBP(userId, 5, 'SHARE', display_name, isFan, isVip);
          })();
        }

        // === LIVE END ===
        if (type === 'liveEnd' || type === 'streamEnd') {
          console.log(`[END] Stream beëindigd → arena geleegd`);
          arenaClear();
        }
      });
    } catch (err) {
      console.error('JSON parse error:', err);
    }
  });

  ws.on('close', (code) => {
    console.log(`WebSocket gesloten (code ${code}) – herconnect over 5 sec...`);
    setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', (err) => {
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
