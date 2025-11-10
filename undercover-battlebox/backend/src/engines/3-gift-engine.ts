// src/engines/3-gift-engine.ts — FINAL FINAL FINAL – 100% SCHOON – NOOIT MEER FOUTEN
import { getOrUpdateUser } from './2-user-engine';
import { addDiamonds, addBP } from './4-points-engine';
import { io } from '../server';
import { getArena, addDiamondsToArenaPlayer } from './5-game-engine';

let REAL_HOST_ID = '';

export function initGiftEngine(conn: any, hostInfo: { id: string }) {
  REAL_HOST_ID = hostInfo.id;

  conn.on('gift', async (data: any) => {
    try {
      const senderId = (data.user?.userId || data.sender?.userId || data.userId || '??').toString();
      const receiverId = (data.receiverUserId || data.toUserId || '??').toString();
      if (senderId === '??') return;

      const diamonds = data.diamondCount || 0;
      if (diamonds === 0) return;

      const giftName = data.giftName || 'Onbekend';
      const isToRealHost = receiverId === REAL_HOST_ID || REAL_HOST_ID === 'FORCE_MANUAL';

      const sender = await getOrUpdateUser(senderId, data.user?.nickname, data.user?.uniqueId);

      let receiverDisplay = 'Host';
      let receiverUsername = 'host';
      let receiverTag = '(HOST)';

      if (!isToRealHost && receiverId !== '??') {
        const receiver = await getOrUpdateUser(receiverId, data.toUser?.nickname, data.toUser?.uniqueId);
        receiverDisplay = receiver.display_name;
        receiverUsername = receiver.username;
        receiverTag = '(CO-HOST)';
      } else if (isToRealHost) {
        const host = await getOrUpdateUser(REAL_HOST_ID);
        receiverDisplay = host.display_name;
        receiverUsername = host.username;
      }

      console.log('\n[GIFT] – PERFECT');
      console.log(`   Van: ${sender.display_name} (@${sender.username})`);
      console.log(`   Aan: ${receiverDisplay} (@${receiverUsername}) ${receiverTag}`);
      console.log(`   Gift: ${giftName} (${diamonds} diamonds)`);

      // DIAMONDS ALTIJD TOEVOEGEN – GEEN PIJLTJES MEER
      await addDiamonds(BigInt(senderId), diamonds, 'total');
      await addDiamonds(BigInt(senderId), diamonds, 'stream');
      await addDiamonds(BigInt(senderId), diamonds, 'current_round');

      // BP MET TOTAAL
      const bp = diamonds * 0.2;
      await addBP(BigInt(senderId), bp, 'GIFT', sender.display_name);

      // ALLEEN CO-HOST GIFTS TELLEN MEE IN ARENA
      if (!isToRealHost) {
        const arena = getArena();
        if (arena.players.some((p: any) => p.id === senderId)) {
          await addDiamondsToArenaPlayer(senderId, diamonds);
        }
      } else {
        console.log(`   → Gift aan echte host → géén arena update (twist ready)`);
      }

      console.log('='.repeat(80));
    } catch (err: any) {
      console.error('[GIFT FOUT]', err.message);
    }
  });
}
