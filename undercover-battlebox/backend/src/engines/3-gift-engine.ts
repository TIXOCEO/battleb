// src/engines/3-gift-engine.ts — FINAL – NOOIT MEER UNKNOWN – 11 NOV 2025 01:00 CET
import { getOrUpdateUser } from './2-user-engine';
import { addDiamonds, addBP } from './4-points-engine';
import { getArena, addDiamondsToArenaPlayer } from './5-game-engine';

const HOST_USERNAME = (process.env.TIKTOK_USERNAME || '').replace('@', '').toLowerCase().trim();
if (!HOST_USERNAME) {
  console.error('TIKTOK_USERNAME ontbreekt in .env → gifts werken niet!');
  process.exit(1);
}

export function initGiftEngine(conn: any) {
  const handleGift = async (data: any) => {
    try {
      // SENDER
      const senderId = (data.user?.userId || data.sender?.userId || data.userId || '??').toString();
      if (senderId === '??') return;

      const diamonds = data.diamondCount || 0;
      if (diamonds === 0) return;

      const giftName = data.giftName || 'Onbekend';

      // ONTVANGER – ALLE MOGELIJKE VELDEN
      const receiverUniqueId = (
        data.toUser?.uniqueId ||
        data.receiver?.uniqueId ||
        data.receiverUniqueId ||
        data.toUserId ||
        ''
      ).toString().replace('@', '').toLowerCase().trim();

      // FALLBACK: als uniqueId leeg is → gebruik display name of nickname
      const receiverDisplay = (
        data.toUser?.nickname ||
        data.receiver?.nickname ||
        data.toUser?.displayName ||
        'HOST'
      );

      // IS DIT EEN GIFT AAN DE ECHTE HOST?
      const isToHost = receiverUniqueId === HOST_USERNAME ||
                       receiverUniqueId.includes(HOST_USERNAME) ||
                       receiverDisplay.toLowerCase().includes(HOST_USERNAME);

      // SENDER INFO
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

      // PERFECTE LOG
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

  conn.on('gift', handleGift);
  conn.on('liveRoomGift', handleGift);

  console.log(`[GIFT ENGINE] Host = @${HOST_USERNAME} → fallback actief → NOOIT MEER UNKNOWN`);
}
