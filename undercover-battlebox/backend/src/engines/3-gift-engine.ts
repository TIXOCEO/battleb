// src/engines/3-gift-engine.ts — ALLE GIFTS UNIEK — HOST OF CO-HOST — 11 NOV 2025 10:25 CET
import { getOrUpdateUser } from './2-user-engine';
import { addDiamonds, addBP } from './4-points-engine';
import { getArena, addDiamondsToArenaPlayer } from './5-game-engine';
import dotenv from 'dotenv';
dotenv.config();

const HOST_USERNAME = (process.env.TIKTOK_USERNAME || '').replace('@', '').toLowerCase().trim();
if (!HOST_USERNAME) {
  console.error('FATAL: TIKTOK_USERNAME ontbreekt!');
  process.exit(1);
}

// DIT IS DE ULTIEME KEY: ALLES UNIEK
const seenGiftKeys = new Map<string, number>(); // key → timestamp

function generateGiftKey(data: any): string {
  const senderId = (data.user?.userId || data.sender?.userId || '??').toString();
  const diamonds = data.diamondCount || 0;
  const giftName = data.giftName || '';
  const eventType = data.__event || 'unknown'; // 'gift' of 'liveRoomGift'

  // ONTVANGER
  const receiverUniqueId = (
    data.toUser?.uniqueId ||
    data.receiver?.uniqueId ||
    data.receiverUniqueId ||
    ''
  ).toString().replace('@', '').toLowerCase().trim();

  const isToHost = 
    receiverUniqueId === HOST_USERNAME ||
    receiverUniqueId.includes(HOST_USERNAME);

  // PRIORITEIT: msgId (als die er is)
  const msgId = data.msgId || data.giftId || data.id;
  if (msgId) return `msgid:${msgId}`;

  // ANDERS: sender + receiver + gift + event + seconde
  const second = Math.floor(Date.now() / 1000);
  return `${eventType}:${senderId}:${receiverUniqueId}:${giftName}:${diamonds}:${second}`;
}

export function initGiftEngine(conn: any) {
  const handleGift = async (data: any) => {
    const key = generateGiftKey(data);
    const now = Date.now();

    // ALS WE HEM RECENT HEBBEN GEZIEN → IGNORE
    const lastSeen = seenGiftKeys.get(key);
    if (lastSeen && now - lastSeen < 3000) { // 3 seconden
      console.log(`[GIFT] Duplicaat genegeerd → ${key}`);
      return;
    }

    seenGiftKeys.set(key, now);
    setTimeout(() => seenGiftKeys.delete(key), 5000);

    try {
      const senderId = (data.user?.userId || data.sender?.userId || data.userId || '??').toString();
      if (senderId === '??') return;

      const diamonds = data.diamondCount || 0;
      if (diamonds === 0) return;

      const giftName = data.giftName || 'Onbekend';

      const receiverUniqueId = (
        data.toUser?.uniqueId ||
        data.receiver?.uniqueId ||
        data.receiverUniqueId ||
        ''
      ).toString().replace('@', '').toLowerCase().trim();

      const receiverDisplay = (
        data.toUser?.nickname ||
        data.receiver?.nickname ||
        data.toUser?.displayName ||
        'HOST'
      ).toLowerCase();

      const isToHost = 
        receiverUniqueId === HOST_USERNAME ||
        receiverUniqueId.includes(HOST_USERNAME) ||
        receiverDisplay.includes(HOST_USERNAME);

      const sender = await getOrUpdateUser(
        senderId,
        data.user?.nickname || data.sender?.nickname,
        data.user?.uniqueId || data.sender?.uniqueId
      );

      let receiverName = HOST_USERNAME.toUpperCase();
      let receiverTag = '(HOST)';

      if (!isToHost && receiverUniqueId) {
        const receiver = await getOrUpdateUser(
          data.receiverUserId || data.toUserId || senderId,
          data.toUser?.nickname || data.receiver?.nickname,
          data.toUser?.uniqueId || data.receiver?.uniqueId
        );
        receiverName = receiver.display_name;
        receiverTag = '(CO-HOST)';
      }

      console.log('\n[GIFT] – PERFECT');
      console.log(`   Van: ${sender.display_name} (@${sender.username})`);
      console.log(`   Aan: ${receiverName} ${receiverTag}`);
      console.log(`   Gift: ${giftName} (${diamonds} diamonds)`);

      await addDiamonds(BigInt(senderId), diamonds, 'total');
      await addDiamonds(BigInt(senderId), diamonds, 'stream');
      await addDiamonds(BigInt(senderId), diamonds, 'current_round');
      await addBP(BigInt(senderId), diamonds * 0.2, 'GIFT', sender.display_name);

      if (!isToHost) {
        const arena = getArena();
        if (arena.players.some((p: any) => p.id === senderId)) {
          await addDiamondsToArenaPlayer(senderId, diamonds);
          console.log(`   +${diamonds} diamonds → ARENA`);
        }
      } else {
        console.log(`   TWIST GIFT → géén arena update`);
      }

      console.log('='.repeat(80));
    } catch (err: any) {
      console.error('[GIFT FOUT]', err.message);
    }
  };

  // LUISTER NAAR BEIDE, MAAR VERWERK SLECHTS 1X
  conn.on('gift', (data: any) => {
    data.__event = 'gift';
    handleGift(data);
  });
  conn.on('liveRoomGift', (data: any) => {
    data.__event = 'liveRoomGift';
    handleGift(data);
  });

  console.log(`[GIFT ENGINE] LIVE → @${HOST_USERNAME} → ALLE GIFTS UNIEK`);
}
