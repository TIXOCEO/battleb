// In tiktokLiveConnection.on('chat', ...)
const msg = data.comment.toLowerCase().trim();
const user = data.uniqueId;
const nick = data.nickname;

// Badge detectie
const badges: string[] = [];
if (data.isSuperFan) badges.push('superfan');
if (data.isFanClub) badges.push('fanclub');
if (data.isVip) badges.push('vip');

// Update user badges
await pool.query(
  'INSERT INTO users (tiktok_id, username, badges) VALUES ($1, $2, $3) ON CONFLICT (tiktok_id) DO UPDATE SET badges = $3',
  [user, nick, badges]
);

if (msg === '!join') {
  try {
    await addToQueue(user, nick);
    emitQueue();
  } catch (e: any) {
    console.log('Join error:', e.message);
  }
}

if (msg.startsWith('!boost rij ')) {
  const spots = parseInt(msg.split(' ')[2]);
  if (spots >= 1 && spots <= 5) {
    try {
      await boostQueue(user, spots);
      emitQueue();
      console.log(`@${nick} boost +${spots} plekken`);
    } catch (e: any) {
      console.log('Boost error:', e.message);
    }
  }
}

if (msg === '!leave') {
  try {
    const refund = await leaveQueue(user);
    if (refund > 0) {
      console.log(`@${nick} kreeg ${refund} BP terug`);
    }
    emitQueue();
  } catch (e) {
    console.log('Leave error:', e);
  }
}