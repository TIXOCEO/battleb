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

// === STATE PER STREAM (reset bij herstart) ===
const hasFollowed = new Set<string>();
const pendingLikes = new Map<string, number>(); // user → likes in deze stream

// === HELPER: Zorg dat user bestaat + haal oude BP op (100% crash-vrij + TS-vriendelijk) ===
async function ensureUserAndGetOldBP(tiktok_id: string, username: string, badges: string[]) {
  const updateRes = await pool.query(
    `UPDATE users SET username = $2, badges = $3 WHERE tiktok_id = $1 RETURNING bp_total`,
    [tiktok_id, username, badges]
  );

  if ((updateRes.rowCount ?? 0) > 0) {
    return parseFloat(updateRes.rows[0].bp_total) || 0;
  }

  await pool.query(
    `INSERT INTO users (tiktok_id, username, badges, bp_total)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (tiktok_id) DO NOTHING`,
    [tiktok_id, username, badges]
  );

  console.log(`[NEW USER] @${username}`);
  return 0;
}

// === HELPER: Voeg BP toe + log oude → nieuwe ===
async function addBP(tiktok_id: string, amount: number, action: string, nick: string) {
  const oldRes = await pool.query('SELECT bp_total FROM users WHERE tiktok_id = $1', [tiktok_id]);
  const oldBP = parseFloat(oldRes.rows[0]?.bp_total) || 0;

  await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [amount, tiktok_id]);

  const newRes = await pool.query('SELECT bp_total FROM users WHERE tiktok_id = $1', [tiktok_id]);
  const newBP = parseFloat(newRes.rows[0]?.bp_total) || 0;

  console.log(`[${action}] @${nick}`);
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
    const rawComment = data.comment;
    const msg = rawComment ? String(rawComment).toLowerCase().trim() : '';
    console.log(`[CHAT] Raw: "${rawComment}" → Parsed: "${msg}" (user: @${data.nickname})`);
    if (!msg) return;

    const user = data.uniqueId;
    const nick = data.nickname;

    // === BADGE DETECTIE MET CUSTOM FANCLUB NAAM ===
    const badges: string[] = [];
    if (data.isSuperFan === true) badges.push('superfan');
    if (data.isVip === true) badges.push('vip');
    if (data.isFanClubMember === true) {
      const clubName = data.fanClubName || 'fanclub';
      badges.push(`fanclub:${clubName}`); // → fanclub:Cats
    }

    // Log badges ALTIJD als ze er zijn
    if (badges.length > 0) {
      console.log(`[BADGES: ${badges.join(' | ')}]`);
    }

    await ensureUserAndGetOldBP(user, nick, badges);
    await addBP(user, 1, 'CHAT', nick);

    // === COMMANDOS ===
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

  // === GIFTS – 50% BP ===
  tiktokLiveConnection.on('gift', async (data: any) => {
    const diamonds = data.diamondCount || 0;
    const giftBP = diamonds * 0.5;
    if (giftBP <= 0) return;

    const user = data.uniqueId;
    const nick = data.nickname;

    const badges: string[] = [];
    if (data.isSuperFan === true) badges.push('superfan');
    if (data.isVip === true) badges.push('vip');
    if (data.isFanClubMember === true) {
      const clubName = data.fanClubName || 'fanclub';
      badges.push(`fanclub:${clubName}`);
    }

    if (badges.length > 0) console.log(`[BADGES: ${badges.join(' | ')}]`);

    await ensureUserAndGetOldBP(user, nick, badges);
    await addBP(user, giftBP, 'GIFT', nick);
    console.log(`→ ${data.giftName} (${diamonds} diamonds)`);
  });

  // === LIKES – +1 BP per 100 likes ===
  tiktokLiveConnection.on('like', async (data: any) => {
    const user = data.uniqueId;
    const nick = data.nickname;
    const likes = data.likeCount || 1;

    const current = pendingLikes.get(user) || 0;
    const total = current + likes;
    pendingLikes.set(user, total);

    const fullHundreds = Math.floor(total / 100);
    const remainder = total % 100;

    if (fullHundreds > 0) {
      const badges: string[] = [];
      if (data.isSuperFan === true) badges.push('superfan');
      if (data.isVip === true) badges.push('vip');
      if (data.isFanClubMember === true) {
        const clubName = data.fanClubName || 'fanclub';
        badges.push(`fanclub:${clubName}`);
      }
      if (badges.length > 0) console.log(`[BADGES: ${badges.join(' | ')}]`);

      await ensureUserAndGetOldBP(user, nick, badges);
      await addBP(user, fullHundreds * 1, 'LIKE', nick);
      console.log(`→ +${likes} likes → ${fullHundreds}x100 (totaal: ${total})`);
      pendingLikes.set(user, remainder);
    }
  });

  // === FOLLOW – +5 BP (1e keer) ===
  tiktokLiveConnection.on('follow', async (data: any) => {
    const user = data.uniqueId;
    const nick = data.nickname;

    if (hasFollowed.has(user)) return;
    hasFollowed.add(user);

    const badges: string[] = [];
    if (data.isSuperFan === true) badges.push('superfan');
    if (data.isVip === true) badges.push('vip');
    if (data.isFanClubMember === true) {
      const clubName = data.fanClubName || 'fanclub';
      badges.push(`fanclub:${clubName}`);
    }
    if (badges.length > 0) console.log(`[BADGES: ${badges.join(' | ')}]`);

    await ensureUserAndGetOldBP(user, nick, badges);
    await addBP(user, 5, 'FOLLOW', nick);
    console.log(`→ eerste follow in deze stream`);
  });

  // === SHARE – +5 BP (elke keer) ===
  tiktokLiveConnection.on('share', async (data: any) => {
    const user = data.uniqueId;
    const nick = data.nickname;

    const badges: string[] = [];
    if (data.isSuperFan === true) badges.push('superfan');
    if (data.isVip === true) badges.push('vip');
    if (data.isFanClubMember === true) {
      const clubName = data.fanClubName || 'fanclub';
      badges.push(`fanclub:${clubName}`);
    }
    if (badges.length > 0) console.log(`[BADGES: ${badges.join(' | ')}]`);

    await ensureUserAndGetOldBP(user, nick, badges);
    await addBP(user, 5, 'SHARE', nick);
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
