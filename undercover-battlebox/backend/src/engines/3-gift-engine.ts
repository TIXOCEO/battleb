// src/engines/3-gift-engine.ts — FINAL VERSION – NOVEMBER 2025
import { getOrUpdateUser } from './2-user-engine';
import { addDiamonds, addBP } from './4-points-engine';
import { io } from '../server';
import { getArena, addDiamondsToArenaPlayer } from './5-game-engine';

let hostId = '';
let HOST_DISPLAY_NAME = 'Host';
let HOST_USERNAME = 'host';

export function initGiftEngine(conn: any, hostInfo: { id: string; name: string; username: string }) {
  hostId = hostInfo.id;
  HOST_DISPLAY_NAME = hostInfo.name;
  HOST_USERNAME = hostInfo.username;

  conn.on('gift', async (data: any) => {
    try {
      const senderId = (data.user?.userId || data.sender?.userId || data.userId || '??').toString();
      const receiverId = (data.receiverUserId || data.toUserId || hostId || '??').toString();
      if (senderId === '??') return;

      const diamonds = data.diamondCount || 0;
      if (diamonds === 0) return;

      const giftName = data.giftName || 'Onbekend';
      const isToHost = receiverId === hostId;

      // Sender ophalen/updaten
      const sender = await getOrUpdateUser(senderId, data.user?.nickname, data.user?.uniqueId);

      // Receiver (host of co-host)
      let receiverDisplay = HOST_DISPLAY_NAME;
      let receiverUsername = HOST_USERNAME;
      let receiverTag = '(HOST)';

      if (!isToHost && receiverId !== '??') {
        const receiver = await getOrUpdateUser(receiverId, data.toUser?.nickname, data.toUser?.uniqueId);
        receiverDisplay = receiver.display_name;
        receiverUsername = receiver.username;
        receiverTag = '(CO-HOST)';
      }

      console.log('\n[GIFT] – PERFECT');
      console.log(`   Van: ${sender.display_name} (@${sender.username})`);
      console.log(`   Aan: ${receiverDisplay} (@${receiverUsername}) ${receiverTag}`);
      console 당신.log(`   Gift: ${giftName} (${diamonds} diamonds)`);

      // DIAMONDS TOEVOEGEN
      await addDiamonds(BigInt(senderId), diamonds, 'total');
      await addDiamonds(BigInt(senderId), diamonds, 'stream');
      await addDiamonds(BigInt(senderId), diamonds, 'current_round');

      // BP = 20%
      const bp = diamonds * 0.2;
      await addBP(BigInt(senderId), bp, 'GIFT', sender.display_name);

      // ALS DE SENDER IN DE ARENA ZIT → LIVE UPDATE + DIAMONDS IN RONDE
      const currentArena = getArena();
      const isInArena = currentArena.players.some((p: any) => p.id === senderId);

      if (isInArena) {
        await addDiamondsToArenaPlayer(senderId, diamonds);
        io.emit('updateArena', currentArena); // Forceer live update
      }

      console.log(`[BP +${bp.toFixed(1)}] → ${sender.display_name}`);
      console.log('='.repeat(80));
    } catch (err: any) {
      console.error('[GIFT FOUT]', err.message);
    }
  });
}
