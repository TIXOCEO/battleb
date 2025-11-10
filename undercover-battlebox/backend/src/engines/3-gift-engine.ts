// src/engines/3-gift-engine.ts — 100% WERKT – GETEST OP LIVE
import { getOrUpdateUser } from './2-user-engine';
import { addDiamonds, addBP } from './4-points-engine';
import { getArena, addDiamondsToArenaPlayer } from './5-game-engine';

const HOST_USERNAME = process.env.TIKTOK_USERNAME?.replace('@', '').toLowerCase() || 'unknown';

export function initGiftEngine(conn: any) {
  conn.on('gift', async (data: any) => {
    try {
      // SENDER
      const senderId = (data.user?.userId || data.sender?.userId || '??').toString();
      if (senderId === '??') return;

      // DIAMONDS
      const diamonds = data.diamondCount || 0;
      if (diamonds === 0) return;

      // GIFT NAAM
      const giftName = data.giftName || 'Onbekend';

      // ONTVANGER (UNIEKE ID)
      const receiverUniqueId = (data.toUser?.uniqueId || data.receiverUniqueId || '').replace('@', '').toLowerCase();

      // IS DIT EEN GIFT AAN DE ECHTE HOST?
      const isToHost = receiverUniqueId === HOST_USERNAME;

      // SENDER INFO
      const sender = await getOrUpdateUser(
        senderId,
        data.user?.nickname || data.sender?.nickname,
        data.user?.uniqueId || data.sender?.uniqueId
      );

      // ONTVANGER INFO
      let receiverName = HOST_USERNAME;
      let receiverTag = '(HOST)';
      if (!isToHost && receiverUniqueId) {
        const receiver = await getOrUpdateUser(
          data.receiverUserId || senderId,
          data.toUser?.nickname,
          data.toUser?.uniqueId
        );
        receiverName = receiver.username;
        receiverTag = '(CO-HOST)';
      }

      // LOG HET PERFECT
      console.log('\n[GIFT] – PERFECT');
      console.log(`   Van: ${sender.display_name} (@${sender.username})`);
      console.log(`   Aan: ${receiverName.toUpperCase()} ${receiverTag}`);
      console.log(`   Gift: ${giftName} (${diamonds} diamonds)`);

      // DIAMONDS TOEVOEGEN
      await addDiamonds(BigInt(senderId), diamonds, 'total');
      await addDiamonds(BigInt(senderId), diamonds, 'stream');
      await addDiamonds(BigInt(senderId), diamonds, 'current_round');

      // BP
      await addBP(BigInt(senderId), diamonds * 0.2, 'GIFT', sender.display_name);

      // ARENA UPDATE (alleen co-host gifts)
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
      console.error('GIFT FOUT:', err.message);
    }
  });
}
