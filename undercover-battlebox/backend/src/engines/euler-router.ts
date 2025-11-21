// ============================================================================
// euler-router.ts — v1.0 ULTRA EULER EVENT ROUTER
// Undercover BattleBox — vertaalt Euler events naar bestaande engines
// ============================================================================

import { markTikTokEvent } from "../server";

// engines
import { processGiftEuler } from "./euler-to-gift";
import { processChatEuler } from "./euler-to-chat";
import { upsertIdentityFromLooseEvent } from "./2-user-engine";

// ============================================================================
// MAIN ROUTER
// ============================================================================
export function processEulerEvent(packet: any) {
  if (!packet || !packet.type) return;

  markTikTokEvent();

  try {
    switch (packet.type) {
      // ---------------------------------------------------------
      // VIEWERS / ROOM METADATA
      // ---------------------------------------------------------
      case "live_intro":
      case "live_status":
      case "room_info":
      case "stream":
        // Nog niets nodig → eventueel in UI tonen
        return;

      // ---------------------------------------------------------
      // CHAT
      // ---------------------------------------------------------
      case "chat":
        if (packet.data) {
          processIdentity(packet.data);
          processChatEuler(packet.data);
        }
        return;

      // ---------------------------------------------------------
      // GIFT
      // ---------------------------------------------------------
      case "gift":
        if (packet.data) {
          processIdentity(packet.data);
          processGiftEuler(packet.data);
        }
        return;

      // ---------------------------------------------------------
      // LIKE
      // ---------------------------------------------------------
      case "like":
      case "social":
      case "follow":
      case "join":
      case "subscribe":
      case "member":
        processIdentity(packet.data);
        return;

      // ---------------------------------------------------------
      // BATTLE EVENTS (later uitbreiden)
      // ---------------------------------------------------------
      case "battle":
      case "battle_start":
      case "battle_update":
      case "battle_end":
        // Voor nu skippen, later integreren
        processIdentity(packet.data);
        return;

      // ---------------------------------------------------------
      // UNMAPPED
      // ---------------------------------------------------------
      default:
        processIdentity(packet.data);
        return;
    }
  } catch (err) {
    console.error("❌ processEulerEvent:", err);
  }
}

// ============================================================================
// IDENTITY SYNC
// ============================================================================
function processIdentity(raw: any) {
  if (!raw) return;

  const u =
    raw.user ||
    raw.sender ||
    raw.receiver ||
    raw.toUser ||
    raw.userIdentity ||
    raw;

  if (!u) return;

  upsertIdentityFromLooseEvent({
    userId: u.userId || u.id || u.uid || null,
    uniqueId: u.uniqueId || u.unique_id || null,
    nickname: u.nickname || u.displayName || null,
  });
}

// ============================================================================
// END
// ============================================================================
