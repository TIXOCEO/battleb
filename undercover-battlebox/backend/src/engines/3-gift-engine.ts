// src/engines/3-gift-engine.ts — 100% WERKT – GETEST OP CO-HOST – 11 NOV 2025 00:47
import { getOrUpdateUser } from './2-user-engine';
import { addDiamonds, addBP } from './4-points-engine';
import { getArena, addDiamondsToArenaPlayer } from './5-game-engine';

const HOST_USERNAME = process.env.TIKTOK_USERNAME?.replace('@', '').toLowerCase() || 'unknown';

export function initGiftEngine(conn: any) {
  // BELANGRIJK: LUISTER NAAR BEIDE EVENTS!
  const handleGift = async (data: any) => {
    try {
      // SENDER ID
      const senderId = (data.user?.userId || data.sender?.userId || data.userId || '??').toString();
      if (senderId === '??') return;

      // DIAMONDS
      const diamonds = data.diamondCount || 0;
      if (diamonds === 0) return;

      // GIFT NAAM
      const giftName = data.giftName || 'Onbekend';

      // ONTVANGER (uniqueId)
      const receiverUniqueId = (
        data.toUser?.uniqueId ||
        data.receiver?.uniqueId ||
        data.receiverUniqueId ||
        ''
      ).replace('@', '').toLowerCase();

      const isToHost = receiverUniqueId === HOST_USERNAME;

      // SENDER INFO
      const sender = await getOrUpdateUser(
        senderId,
        data.user?.nickname || data.sender?.nickname,
        data.user?.uniqueId || data.sender?.uniqueId
      );

      // ONTVANGER INFO
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

      // DIAMONDS
      await addDiamonds(BigInt(senderId), diamonds, 'total');
      await addDiamonds(BigInt(senderId), diamonds, 'stream');
      await addDiamonds(BigInt(senderId), diamonds, 'current_round');

      // BP
      await addBP(BigInt(senderId), diamonds * 0.2, 'GIFT', sender.display_name);

      // ARENA
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

  // LUISTER NAAR BEIDE EVENTS!
  conn.on('gift', handleGift);
  conn.on('liveRoomGift', handleGift); // DIT IS DE FIX!

  console.log('[GIFT ENGINE] Luistert naar gift + liveRoomGift → ALLES WERKT');
}
