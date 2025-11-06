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

// === HELPER: Detecteer FAN op ALLE mogelijke plekken ===
function isFanClubMember(data: any): boolean {
  if (data.isFanClubMember === true) return true;
  if (data.userBadges?.some((b: any) => b.type === 'fanclub')) return true;
  if (data.badgeList?.some((b: any) => b.type === 'fanclub')) return true;
  if (data.fanClubInfo?.fanClubName) return true;
  return false;
}

// === HELPER: User aanmaken/updaten ===
async function ensureUserAndGetOldBP(tiktok_id: string, username: string) {
  const updateRes = await pool.query(
    `UPDATE users SET username = $2 WHERE tiktok_id = $1 RETURNING bp_total`,
    [tiktok_id, username]
  );

  if ((updateRes.rowCount ?? 0) > 0) {
    return parseFloat(updateRes.rows[0].bp_total) || 0;
  }

  await pool.query(
    `INSERT INTO users (tiktok_id, username, bp_total) VALUES ($1, $2, 0) ON CONFLICT (tiktok_id) DO NOTHING`,
    [tiktok_id, username]
  );

  console.log(`[NEW USER] @${username}`);
  return 0;
}

// === HELPER: BP toevoegen met [FAN] tag ===
async function addBP(tiktok_id: string, amount: number, action: string, nick: string, isFan: boolean = false) {
  const oldRes = await pool.query('SELECT bp_total FROM users WHERE tiktok_id = $1', [tiktok_id]);
  const oldBP = parseFloat(oldRes.rows[0]?.bp_total) || 0;

  await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [amount, tiktok_id]);

  const newRes = await pool.query('SELECT bp_total FROM users WHERE tiktok_id = $1', [tiktok_id]);
  const newBP = parseFloat(newRes.rows[0]?.bp_total) || 0;

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
    console.log(`[CHAT] Raw: "${rawComment}" → Parsed: "${msg}" (user: @${data.nickname})`);
    if (!msg) return;

    const user = data.uniqueId;
    const nick = data.nickname;
    const isFan = isFanClubMember(data);

    await ensureUserAndGetOldBP(user, nick);
    await addBP(user, 1, 'CHAT', nick, isFan);

    if (msg === '!join') {
      console.log(`!join ontvangen van @${nick}`);
      try { await addToQueue(user, nick); emitQueue(); } catch (e: any) { console.log('Join error:', e.message); }
    } else if (msg.startsWith('!boost rij ')) {
      const spots = parseInt(msg.split(' ')[2] || '0');
      if (spots >= 1 && spots <= 5) {
        console.log(`!boost rij ${spots} van @${nick}`);
        try { await boostQueue(user, spots); emitQueue(); } catch (e: any) { console.log('Boost error:', e.message); }
      }
    } else if (msg === '!leave') {
      console.log(`!leave ontvangen van @${nick}`);
      try { const refund = await leaveQueue(user); if (refund > 0) console.log(`@${nick} kreeg ${refund} BP terug`); emitQueue(); }
      catch (e: any) { console.log('Leave error:', e.message); }
    }
  });

  // === GIFTS ===
  tiktokLiveConnection.on('gift', async (data: any) => {
    const diamonds = data.diamondCount || 0;
    const giftBP = diamonds * 0.5;
    if (giftBP <= 0) return;

    const user = data.uniqueId;
    const nick = data.nickname;
    const isFan = isFanClubMember(data);

    await ensureUserAndGetOldBP(user, nick);
    await addBP(user, giftBP, 'GIFT', nick, isFan);
    console.log(`→ ${data.giftName} (${diamonds} diamonds)`);
  });

  // === LIKES ===
  tiktokLiveConnection.on('like', async (data: any) => {
    const user = data.uniqueId;
    const nick = data.nickname;
    const likes = data.likeCount || 1;
    const isFan = isFanClubMember(data);

    const current = pendingLikes.get(user) || 0;
    const total = current + likes;
    pendingLikes.set(user, total);

    const fullHundreds = Math.floor(total / 100);
    if (fullHundreds > 0) {
      await ensureUserAndGetOldBP(user, nick);
      await addBP(user, fullHundreds * 1, 'LIKE', nick, isFan);
      console.log(`→ +${likes} likes → ${fullHundreds}x100 (totaal: ${total})`);
      pendingLikes.set(user, total % 100);
    }
  });

  // === FOLLOW ===
  tiktokLiveConnection.on('follow', async (data: any) => {
    const user = data.uniqueId;
    const nick = data.nickname;
    if (hasFollowed.has(user)) return;
    hasFollowed.add(user);
    const isFan = isFanClubMember(data);

    await ensureUserAndGetOldBP(user, nick);
    await addBP(user, 5, 'FOLLOW', nick, isFan);
    console.log(`→ eerste follow in deze stream`);
  });

  // === SHARE ===
  tiktokLiveConnection.on('share', async (data: any) => {
    const user = data.uniqueId;
    const nick = data.nickname;
    const isFan = isFanClubMember(data);

    await ensureUserAndGetOldBP(user, nick);
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
