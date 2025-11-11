// src/engines/3-gift-engine.ts — FINAL – ALLEEN LIVEROOMGIFT – NOOIT MEER DUBBEL – 11 NOV 2025 11:10 CET
import { getOrUpdateUser } from './2-user-engine';
import { addDiamonds, addBP } from './4-points-engine';
import { getArena, addDiamondsToArenaPlayer } from './5-game-engine';
import dotenv from 'dotenv';
dotenv.config();

const HOST_USERNAME = (process.env.TIKTOK_USERNAME || '').replace('@', '').toLowerCase().trim();
if (!HOST_USERNAME) {
  console.error('FATAL: TIKTOK_USERNAME ontbreekt in .env!');
  process.exit(1);
}

// Deduplicatie via msgId – ALLEEN VOOR liveRoomGift
const seenGiftMsgIds = new Set<string>();

export function initGiftEngine(conn: any) {
  // ALLEEN liveRoomGift VERWERKEN – gift EVENT WORDT GEHEEL GENEGEERD
  conn.on('liveRoomGift', async (data: any) => {
    // UNIEKE ID VAN DE GIFT
    const msgId = data.msgId || data.giftId || data.id;
    if (!msgId) {
      console.warn('[GIFT] Geen msgId → genegeerd');
      return;
    }

    // DUBBEL CHECK
    if (seenGiftMsgIds.has(msgId)) {
      console.log(`[GIFT] Duplicaat genegeerd → msgId: ${msgId}`);
      return;
    }

    seenGiftMsgIds.add(msgId);
    setTimeout(() => seenGiftMsgIds.delete(msgId), 15000); // 15 sec veiligheid

    try {
      // SENDER
      const senderId = (data.user?.userId || data.sender?.userId || data.userId || '??').toString();
      if (senderId === '??') return;

      const diamonds = data.diamondCount || 0;
      if (diamonds === 0) return;

      const giftName = data.giftName || 'Onbekend';

      // ONTVANGER
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

      // GEBRUIKERS OPHALEN
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

      // LOG
      console.log('\n[GIFT] – PERFECT');
      console.log(`   Van: ${sender.display_name} (@${sender.username})`);
      console.log(`   Aan: ${receiverName} ${receiverTag}`);
      console.log(`   Gift: ${giftName} (${diamonds} diamonds)`);

      // DIAMONDS & BP
      await addDiamonds(BigInt(senderId), diamonds, 'total');
      await addDiamonds(BigInt(senderId), diamonds, 'stream');
      await addDiamonds(BigInt(senderId), diamonds, 'current_round');
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
  });

  // GIFT EVENT WORDT GEHEEL GENEGEERD
  // → TikTok stuurt dit alleen voor bepaalde gebruikers (A/B test)
  // → liveRoomGift is altijd betrouwbaar

  console.log(`[GIFT ENGINE] LIVE → @${HOST_USERNAME} → ALLEEN liveRoomGift → NOOIT DUBBEL`);
}
