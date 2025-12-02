// ============================================================================
// queue-events.ts — v16.4
// Overlay Event Dispatcher (join / leave / promote / demote)
// 100ms debounce op batch-updates
// ============================================================================

import { io } from "./server";

/**
 * Overlay-friendly payload emitter.
 * Frontend verwacht:
 * {
 *   type: "join" | "leave" | "promote" | "demote",
 *   timestamp: number,
 *   user: {
 *     tiktok_id: string,
 *     username: string,
 *     display_name: string,
 *     is_vip: boolean,
 *     avatar_url: string | null
 *   }
 * }
 */

export function emitQueueEvent(
  type: "join" | "leave" | "promote" | "demote",
  user: any
) {
  io.emit("queueEvent", {
    type,
    timestamp: Date.now(),
    user: {
      tiktok_id: String(user.tiktok_id),
      username: (user.username || "").replace(/^@+/, "").toLowerCase(),
      display_name: user.display_name || "unknown",
      is_vip: !!user.is_vip,
      avatar_url: user.avatar_url ?? null   // 🔥 frontend requirement
    }
  });
}
