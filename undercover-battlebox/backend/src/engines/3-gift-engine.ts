// src/engines/3-gift-engine.ts — FINAL – NOOIT MEER UNKNOWN – NOOIT MEER ONTBREEKT
import { getOrUpdateUser } from './2-user-engine';
import { addDiamonds, addBP } from './4-points-engine';
import { getArena, addDiamondsToArenaPlayer } from './5-game-engine';
import dotenv from 'dotenv';

// DIT IS DE FIX: LAAD .env EXPLICIET
dotenv.config();

// NU PAKT HIJ ECHT DE WAARDE
const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME;
if (!TIKTOK_USERNAME) {
  console.error('FATAL: TIKTOK_USERNAME ontbreekt in .env bestand!');
  console.error('   → Zorg dat je .env bestand in /var/www/undercover-battlebox/backend/.env staat');
  console.error('   → En dat er staat: TIKTOK_USERNAME=livezone01');
  process.exit(1);
}

const HOST_USERNAME = TIKTOK_USERNAME.replace('@', '').toLowerCase().trim();

console.log(`[GIFT ENGINE] Host gezet op: @${HOST_USERNAME} → ALLES WERKT`);

export function initGiftEngine(conn: any) {
  const handleGift = async (data: any) => {
    try {
      const senderId = (data.user?.userId || data.sender?.userId || data.userId || '??').toString();
      if (senderId === '??') return;

      const diamonds = data.diamondCount || 0;
      if (diamonds === 0) return;

      const giftName = data.giftName || 'Onbekend';

      // ONTVANGER INFO
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

      // SMART HOST DETECTIE
      const isToHost = 
        receiverUniqueId === HOST_USERNAME ||
        receiverUniqueId.includes(HOST_USERNAME) ||
        receiverDisplay.includes(HOST_USERNAME);

      // SENDER
      const sender = await getOrUpdateUser(
        senderId,
        data.user?.nickname || data.sender?.nickname,
        data.user?.uniqueId || data.sender?.uniqueId
      );

      // ONTVANGER NAAM
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

      if (!isToHost && getArena().players.some((p: any) => p.id === senderId)) {
        await addDiamondsToArenaPlayer(senderId, diamonds);
        console.log(`   +${diamonds} diamonds → ARENA`);
      } else if (isToHost) {
        console.log(`   TWIST GIFT → géén arena update`);
      }

      console.log('='.repeat(80));
    } catch (err: any) {
      console.error('[GIFT FOUT]', err.message);
    }
  };

  conn.on('gift', handleGift);
  conn.on('liveRoomGift', handleGift);

  console.log(`[GIFT ENGINE] LIVE → luistert naar gifts voor @${HOST_USERNAME}`);
}
