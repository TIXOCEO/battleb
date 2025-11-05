// core/tiktok-connector.js
const { WebcastPushConnection } = require('tiktok-live-connector');
const { getUser, updateUserBP, run, all } = require('./db');
const fs = require('fs');

let tiktokLiveConnection;

async function connectTikTok(io) {
  const username = global.CONFIG.hostUsername;
  tiktokLiveConnection = new WebcastPushConnection(username);

  console.log(`Verbinding met TikTok Live van @${username}...`);

  tiktokLiveConnection.connect().then(state => {
    console.log(`Verbonden! Sessie ID: ${state.sessionId}`);
  }).catch(err => {
    console.error('Connectie mislukt:', err);
  });

  // Gift event
  tiktokLiveConnection.on('gift', async data => {
    if (!data || !data.giftName) return;

    const giftName = data.giftName.toLowerCase();
    const diamonds = data.diamondCount || 0;
    const userId = data.uniqueId;
    const nickname = data.nickname;

    if (diamonds <= 0) return;

    // Log
    await logAction(userId, 'gift', `${nickname} stuurde ${giftName} (${diamonds} diamonds)`);

    // BP voor gifter
    const bpEarned = diamonds * 0.5;
    await addBP(userId, bpEarned, 'gift_sent');

    // Als deelnemer in game → punten + BP
    const state = await getGameState();
    if (state.phase === 'preround' || state.phase === 'final') {
      const participants = JSON.parse(state.participants || '[]');
      const participant = participants.find(p => p.id === userId);
      if (participant) {
        participant.points += diamonds;
        participant.bp += bpEarned;
        await updateGameState('participants', JSON.stringify(participants));
        await addBP(userId, bpEarned, 'gift_received');
        io.emit('updateScoreboard', { participants });
      }
    }

    // Twist tegoed (alleen voorrondes)
    if (state.phase === 'preround') {
      const twistMap = {
        'galaxy': 'sterrenstelsel',
        'gun': 'geldpistool',
        'wings': 'vleugels',
        'diamond gun': 'diamantpistool'
      };
      const twistKey = Object.keys(twistMap).find(k => giftName.includes(k));
      if (twistKey) {
        const user = await getOrCreateUser(userId, nickname);
        const twists = JSON.parse(user.twists || '{}');
        twists[twistMap[twistKey]] = (twists[twistMap[twistKey]] || 0) + 1;
        await run(`UPDATE users SET twists = ? WHERE id = ?`, [JSON.stringify(twists), userId]);
        io.emit('twistEarned', { user: nickname, twist: twistMap[twistKey] });
      }
    }
  });

  // Comment → BP
  tiktokLiveConnection.on('comment', async data => {
    const userId = data.uniqueId;
    await addBP(userId, 3, 'chat');
  });

  // Follow → BP
  tiktokLiveConnection.on('follow', async data => {
    const userId = data.uniqueId;
    await addBP(userId, 50, 'follow');
  });

  // Join → BP
  tiktokLiveConnection.on('member', async data => {
    const userId = data.uniqueId;
    await addBP(userId, 10, 'join');
  });
}

async function getOrCreateUser(id, username) {
  let user = await getUser(id);
  if (!user) {
    await run(`INSERT INTO users (id, username) VALUES (?, ?)`, [id, username]);
    user = await getUser(id);
  }
  return user;
}

async function addBP(userId, amount, source) {
  const user = await getOrCreateUser(userId, userId);
  const today = new Date().toISOString().split('T')[0];
  if (user.bp_reset_date !== today) {
    await run(`UPDATE users SET bp_today = 0, bp_reset_date = ? WHERE id = ?`, [today, userId]);
  }
  if (user.bp_today < global.CONFIG.bpDailyCap) {
    const capped = Math.min(amount, global.CONFIG.bpDailyCap - user.bp_today);
    await updateUserBP(userId, capped);
    await run(`UPDATE users SET bp_today = bp_today + ? WHERE id = ?`, [capped, userId]);
  }
  await logAction(userId, 'bp', `${amount} BP van ${source}`);
}

async function logAction(userId, action, details) {
  await run(`INSERT INTO logs (user_id, action, details) VALUES (?, ?, ?)`, [userId, action, details]);
}

async function getGameState() {
  const rows = await all(`SELECT * FROM game_state`);
  const state = {};
  rows.forEach(r => state[r.key] = r.value);
  return state;
}

async function updateGameState(key, value) {
  await run(`INSERT INTO game_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [key, value, value]);
}

module.exports = { connectTikTok };