// ============================================================================
// euler-to-gift.ts — v1.0 Adapter
// Converts Euler "gift" event → BattleBox processGift()
// ============================================================================

import { processGift as legacyProcessGift } from "./3-gift-engine"; // jouw bestaande (rename needed)
import { TWIST_MAP } from "./twist-definitions";

function norm(v: any) {
  return (v || "").toString().trim().replace(/^@+/, "").toLowerCase();
}

export async function processGiftEuler(data: any) {
  if (!data) return;

  const sender = data.sender || data.user;
  const receiver = data.receiver || null;

  const evt = {
    giftId: data.gift_id || data.id || null,
    giftName: data.gift_name || data.name || "",
    diamondCount: data.diamonds || data.diamond_count || 0,
    repeatCount: data.repeat_count || 1,
    repeatEnd: true,

    user: {
      userId: sender?.user_id || sender?.id || null,
      uniqueId: norm(sender?.unique_id || sender?.uniqueId),
      nickname: sender?.nickname || null,
    },

    receiver: receiver
      ? {
          userId: receiver?.user_id || receiver?.id || null,
          uniqueId: norm(receiver?.unique_id || receiver?.uniqueId),
          nickname: receiver?.nickname || null,
        }
      : null,

    timestamp: Date.now(),
    _data: data,
  };

  try {
    await legacyProcessGift(evt, "euler");
  } catch (err) {
    console.error("❌ processGiftEuler:", err);
  }
}
