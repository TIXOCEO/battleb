// ============================================================================
// euler-router.ts — ULTRA ENGINE 2.0 EVENT ROUTER
// ============================================================================
import { processGiftEuler } from "./euler-to-gift";
import { processChatEuler } from "./euler-to-chat";

export function processEulerEvent(packet: any) {
  if (!packet || !packet.type) return;

  switch (packet.type) {
    case "chat":
      return processChatEuler(packet);

    case "gift":
      return processGiftEuler(packet);

    case "like":
      // eventueel future logic
      return;

    case "follow":
      // eventueel identity update
      return;

    case "join":
    case "member":
      // later arena + queue logic mogelijk
      return;

    case "stream_end":
      console.log("❌ TikTok stream offline");
      return;

    default:
      // debug mode
      // console.log("ℹ Unknown packet:", packet.type);
      return;
  }
}
