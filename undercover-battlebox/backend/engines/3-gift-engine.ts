// engines/3-gift-engine.ts
import { getOrUpdateUser } from './2-user-engine';
import { addDiamonds, addBP } from './4-points-engine';

let HOST_DISPLAY_NAME = 'Host';
let HOST_USERNAME = 'host';
let hostId = '';

export function initGiftEngine(conn: any, hostInfo: { id: string; name: string; username: string }) {
  hostId = hostInfo.id;
  HOST_DISPLAY_NAME = hostInfo.name;
  HOST_USERNAME = hostInfo.username;

  conn.on('gift', async (data: any) => {
    try {
      const senderId = (data.user?.userId || data.sender?.userId || data.userId || '??').toString();
      const receiverId = (data.receiverUserId || data.toUserId || hostId || '??').toString();
      if (senderId === '??' || receiverId === '??') return;

      const diamonds = data.diamondCount || 0;
      const giftName = data.giftName || 'Onbekend';
      const isToHost = receiverId === hostId;

      const [sender, receiver] = await Promise.all([
        getOrUpdateUser(senderId, data.user?.nickname, data.user?.uniqueId),
        isToHost
          ? Promise.resolve({ id: hostId, display_name: HOST_DISPLAY_NAME, username: HOST_USERNAME })
          : getOrUpdateUser(receiverId, data.toUser?.nickname, data.toUser?.uniqueId)
      ]);

      console.log('\n[GIFT] – PERFECT');
      console.log(`   Van: ${sender.display_name} (@${sender.username})`);
      console.log(`   Aan: ${receiver.display_name} (@${receiver.username}) ${isToHost ? '(HOST)' : '(GAST)'}`);
      console.log(`   Gift: ${giftName} (${diamonds} diamonds)`);

      if (diamonds > 0) {
        await addDiamonds(BigInt(senderId), diamonds, 'current_round');
        await addDiamonds(BigInt(senderId), diamonds, 'stream');
        await addDiamonds(BigInt(senderId), diamonds, 'total');

        const bp = diamonds * 0.2;
        await addBP(BigInt(senderId), bp, 'GIFT', sender.display_name);
        console.log(`[BP +${bp.toFixed(1)}] → ${sender.display_name}`);
      }

      if (giftName.toLowerCase().includes('heart me')) {
        await pool.query(
          `INSERT INTO users (tiktok_id, is_fan, fan_expires_at)
           VALUES ($1, true, NOW() + INTERVAL '24 hours')
           ON CONFLICT (tiktok_id) DO UPDATE
           SET is_fan = true, fan_expires_at = NOW() + INTERVAL '24 hours'`,
          [BigInt(senderId)]
        );
      }

      console.log('='.repeat(80));
    } catch (err: any) {
      console.error('[GIFT FOUT]', err.message);
    }
  });
}
