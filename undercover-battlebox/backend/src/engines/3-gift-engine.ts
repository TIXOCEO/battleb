// src/engines/3-gift-engine.ts — NOOIT MEER 2x GG — 11 NOV 2025 02:15 CET
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

// DIT IS DE MAGIE: ALLE GEZIENE GIFTS OPSLAAN
const seenGiftIds = new Set<string>();

export function initGiftEngine(conn: any) {
  const handleGift = async (data: any) => {
    // DE UNIEKE ID VAN DE GIFT
    const msgId = data.msgId || data.giftId || data.id || `${data.user?.userId}-${Date.now()}`;
    
    // ALS WE HEM AL HEBBEN GEZIEN → IGNORE
    if (seenGiftIds.has(msgId)) {
      console.log(`[GIFT] Duplicaat genegeerd → msgId: ${msgId}`);
      return;
    }
    
    // ANDERS: SLA OP EN VERWERK
    seenGiftIds.add(msgId);
    
    // Leeg na 10 seconden (veiligheid)
    setTimeout(() => seenGiftIds.delete(msgId), 10000);

    try {
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

      // ALLEEN 1X TOEVOEGEN
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
  conn.on('gift', handleGift);
  conn.on('liveRoomGift', handleGift);

  console.log(`[GIFT ENGINE] LIVE → @${HOST_USERNAME} → DUPLICATEN ONMOGELIJK`);
}
