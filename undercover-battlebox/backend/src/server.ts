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
const ADMIN_ID = process.env.ADMIN_TIKTOK_ID;

async function activateFanStatus(tiktok_id: string, username: string) {
  await pool.query(
    `INSERT INTO users (tiktok_id, username, bp_total, is_fan, fan_expires_at)
     VALUES ($1, $2, 0, true, NOW() + INTERVAL '24 hours')
     ON CONFLICT (tiktok_id) 
     DO UPDATE SET 
       is_fan = true, 
       fan_expires_at = NOW() + INTERVAL '24 hours',
       username = EXCLUDED.username`,
    [tiktok_id, username]
  );
  console.log(`[FAN ACTIVATED 24H] @${username}`);
}

async function getUserData(tiktok_id: string, username: string) {
  const query = `
    INSERT INTO users (tiktok_id, username, bp_total, is_fan, fan_expires_at, is_vip)
    VALUES ($1, $2, 0, false, NULL, false)
    ON CONFLICT (tiktok_id) 
    DO UPDATE SET username = EXCLUDED.username
    RETURNING bp_total, is_fan, fan_expires_at, is_vip;
  `;

  const res = await pool.query(query, [tiktok_id, username]);
  const row = res.rows[0];

  const isFan = row.is_fan && row.fan_expires_at && new Date(row.fan_expires_at) > new Date();
  const isVip = row.is_vip === true;

  if (!row.bp_total) console.log(`[NEW USER] @${username}`);

  return { oldBP: parseFloat(row.bp_total) || 0, isFan, isVip };
}

async function addBP(tiktok_id: string, amount: number, action: string, nick: string, isFan: boolean, isVip: boolean) {
  const oldRes = await pool.query('SELECT bp_total FROM users WHERE tiktok_id = $1', [tiktok_id]);
  const oldBP = parseFloat(oldRes.rows[0]?.bp_total) || 0;

  await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [amount, tiktok_id]);

  const newRes = await pool.query('SELECT bp_total FROM users WHERE tiktok_id = $1', [tiktok_id]);
  const newBP = parseFloat(newRes.rows[0].bp_total) || 0;

  const fanTag = isFan ? ' [FAN]' : '';
  const vipTag = isVip ? ' [VIP]' : '';
  console.log(`[${action}] @${nick}${fanTag}${vipTag}`);
  console.log(`[BP: +${amount} | ${oldBP.toFixed(1)} → ${newBP.toFixed(1)}]`);
}

async function deductBP(tiktok_id: string, amount: number): Promise<boolean> {
  const res = await pool.query('SELECT bp_total FROM users WHERE tiktok_id = $1', [tiktok_id]);
  const current = parseFloat(res.rows[0]?.bp_total) || 0;
  if (current < amount) return false;

  await pool.query('UPDATE users SET bp_total = bp_total - $1 WHERE tiktok_id = $2', [amount, tiktok_id]);
  return true;
}

async function startTikTokLive(username: string) {
  const tiktokLiveConnection = new WebcastPushConnection(username);

  tiktokLiveConnection.connect().then(state => {
    console.info(`Verbonden met roomId ${state.roomId}`);
  }).catch(err => {
    console.error('Failed to connect to TikTok Live:', err);
  });

  tiktokLiveConnection.on('chat', async (data: any) => {
    const rawComment = data.comment || '';
    const msg = rawComment.toLowerCase().trim();
    if (!msg) return;

    console.log(`[CHAT] Raw: "${rawComment}" → Parsed: "${msg}" (user: @${data.nickname})`);

    const user = data.uniqueId;
    const nick = data.nickname;
    const isAdmin = user === ADMIN_ID;

    const { oldBP, isFan, isVip } = await getUserData(user, nick);
    await addBP(user, 1, 'CHAT', nick, isFan, isVip);

    // ADMIN COMMANDS
    if (isAdmin && msg.startsWith('!admin ')) {
      const cmd = msg.slice(7).trim();
      if (cmd === 'reset fans') {
        await pool.query('UPDATE users SET is_fan = false, fan_expires_at = NULL');
        console.log('[ADMIN] Alle fans gereset');
      }
      if (cmd.startsWith('givebp ')) {
        const [targetNick, amount] = cmd.split(' ').slice(1);
        const targetRes = await pool.query('SELECT tiktok_id FROM users WHERE username ILIKE $1', [`%${targetNick}%`]);
        if (targetRes.rows[0]) {
          await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [parseFloat(amount), targetRes.rows[0].tiktok_id]);
          console.log(`[ADMIN] +${amount} BP aan @${targetNick}`);
        }
      }
      return;
    }

    // !KOOP COMMANDS – ALTIJD TOEGESTAAN
    if (msg.startsWith('!koop ')) {
      const item = msg.slice(6).trim();
      if (item === 'vip') {
        if (await deductBP(user, 5000)) {
          await pool.query('UPDATE users SET is_vip = true WHERE tiktok_id = $1', [user]);
          console.log(`[KOOP] @${nick} kocht VIP voor 5000 BP`);
        } else {
          console.log(`[KOOP FAIL] @${nick} heeft niet genoeg BP voor VIP`);
        }
        return;
      }
      if (item === 'rij') {
        if (await deductBP(user, 10000)) {
          try {
            await addToQueue(user, nick);
            emitQueue();
            console.log(`[KOOP] @${nick} kocht wachtrijplek voor 10000 BP`);
          } catch (e: any) {
            console.log(`[KOOP RIJ FAIL] ${e.message}`);
            // BP teruggeven
            await pool.query('UPDATE users SET bp_total = bp_total + 10000 WHERE tiktok_id = $1', [user]);
          }
        } else {
          console.log(`[KOOP FAIL] @${nick} heeft niet genoeg BP voor rij`);
        }
        return;
      }
    }

    // WACHTRIJ COMMANDS – ALLEEN VOOR FANS
    if (!isFan) {
      console.log(`[NO FAN] @${nick} probeerde wachtrij zonder Heart Me`);
      return;
    }

    if (msg === '!join') {
      console.log(`!join ontvangen van @${nick} [FAN]`);
      try { await addToQueue(user, nick); emitQueue(); } catch (e: any) { console.log('Join error:', e.message); }
    } else if (msg.startsWith('!boost rij ')) {
      const spots = parseInt(msg.split(' ')[2] || '0');
      if (spots >= 1 && spots <= 5) {
        console.log(`!boost rij ${spots} van @${nick} [FAN]`);
        try { await boostQueue(user, spots); emitQueue(); } catch (e: any) { console.log('Boost error:', e.message); }
      }
    } else if (msg === '!leave') {
      console.log(`!leave ontvangen van @${nick} [FAN]`);
      try { const refund = await leaveQueue(user); if (refund > 0) console.log(`@${nick} kreeg ${refund} BP terug`); emitQueue(); }
      catch (e: any) { console.log('Leave error:', e.message); }
    }
  });

  // GIFT – HEART ME = FAN
  tiktokLiveConnection.on('gift', async (data: any) => {
    const user = data.uniqueId;
    const nick = data.nickname;
    const giftName = data.giftName?.toLowerCase();

    if (giftName === 'heart me') {
      await activateFanStatus(user, nick);
      const { isFan, isVip } = await getUserData(user, nick);
      await addBP(user, 0.5, 'GIFT', nick, isFan, isVip);
      console.log(`→ Heart Me → FAN ACTIVATED VOOR 24 UUR`);
      return;
    }

    const diamonds = data.diamondCount || 0;
    const giftBP = diamonds * 0.5;
    if (giftBP <= 0) return;

    const { isFan, isVip } = await getUserData(user, nick);
    await addBP(user, giftBP, 'GIFT', nick, isFan, isVip);
    console.log(`→ ${data.giftName} (${diamonds} diamonds)`);
  });

  // LIKE / FOLLOW / SHARE → ALLES WERKT ZONDER FAN
  tiktokLiveConnection.on('like', async (data: any) => {
    const user = data.uniqueId;
    const nick = data.nickname;
    const likes = data.likeCount || 1;
    const current = pendingLikes.get(user) || 0;
    const total = current + likes;
    pendingLikes.set(user, total);
    const fullHundreds = Math.floor(total / 100);
    if (fullHundreds > 0) {
      const { isFan, isVip } = await getUserData(user, nick);
      await addBP(user, fullHundreds, 'LIKE', nick, isFan, isVip);
      console.log(`→ +${likes} likes → ${fullHundreds}x100`);
      pendingLikes.set(user, total % 100);
    }
  });

  tiktokLiveConnection.on('follow', async (data: any) => {
    const user = data.uniqueId;
    const nick = data.nickname;
    if (hasFollowed.has(user)) return;
    hasFollowed.add(user);
    const { isFan, isVip } = await getUserData(user, nick);
    await addBP(user, 5, 'FOLLOW', nick, isFan, isVip);
    console.log(`→ eerste follow in deze stream`);
  });

  tiktokLiveConnection.on('share', async (data: any) => {
    const user = data.uniqueId;
    const nick = data.nickname;
    const { isFan, isVip } = await getUserData(user, nick);
    await addBP(user, 5, 'SHARE', nick, isFan, isVip);
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
