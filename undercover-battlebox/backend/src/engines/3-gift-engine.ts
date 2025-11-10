// src/engines/3-gift-engine.ts — FINAL – BRILJANT SIMPEL
import { getOrUpdateUser } from './2-user-engine';
import { addDiamonds, addBP } from './4-points-engine';
import { getArena, addDiamondsToArenaPlayer } from './5-game-engine';

const REAL_HOST_USERNAME = process.env.TIKTOK_USERNAME?.replace('@', '').toLowerCase() || 'unknown';

export function initGiftEngine(conn: any) {
  conn.on('gift', async (data: any) => {
    try {
      const senderId = (data.user?.userId || data.sender?.userId || '??').toString();
      if (senderId === '??') return;

      const receiverUniqueId = (data.toUser?.uniqueId || data.receiverUniqueId || '').replace('@', '').toLowerCase();
      const diamonds = data.diamondCount || 0;
      if (diamonds === 0) return;

      const giftName = data.giftName || 'Onbekend';
      const isToRealHost = receiverUniqueId === REAL_HOST_USERNAME;

      const sender = await getOrUpdateUser(senderId, data.user?.nickname, data.user?.uniqueId);

      let receiverDisplay = 'Host';
      let receiverUsername = REAL_HOST_USERNAME;
      let receiverTag = '(HOST)';

      if (!isToRealHost && receiverUniqueId && receiverUniqueId !== '') {
        const receiver = await getOrUpdateUser(data.receiverUserId || senderId, data.toUser?.nickname, data.toUser?.uniqueId);
        receiverDisplay = receiver.display_name;
        receiverUsername = receiver.username;
        receiverTag = '(CO-HOST)';
      }

      console.log('\n[GIFT] – PERFECT');
      console.log(`   Van: ${sender.display_name} (@${sender.username})`);
      console.log(`   Aan: ${receiverDisplay} (@${receiverUsername}) ${receiverTag}`);
      console.log(`   Gift: ${giftName} (${diamonds} diamonds)`);

      // DIAMONDS ALTIJD TOEVOEGEN
      await addDiamonds(BigInt(senderId), diamonds, 'total');
      await addDiamonds(BigInt(senderId), diamonds, 'stream');
      await addDiamonds(BigInt(senderId), diamonds, 'current_round');

      // BP MET TOTAAL
      const bp = diamonds * 0.2;
      await addBP(BigInt(senderId), bp, 'GIFT', sender.display_name);

      // ALLEEN CO-HOST GIFTS → ARENA
      if (!isToRealHost) {
        const arena = getArena();
        if (arena.players.some((p: any) => p.id === senderId)) {
          await addDiamondsToArenaPlayer(senderId, diamonds);
          console.log(`   +${diamonds} diamonds in arena!`);
        }
      } else {
        console.log(`   TWIST GIFT → géén arena update`);
      }

      console.log('='.repeat(80));
    } catch (err: any) {
      console.error('[GIFT FOUT]', err.message);
    }
  });
}
