// ============================================================================
// queue-events.ts — v16.5
// Overlay Event Dispatcher (join / leave / promote / demote)
// Supports: admin-panel + overlay-room
// ============================================================================

import { io } from "./server";

/**
 * Payload shape expected by overlays:
 *
 * {
 *   type: "join" | "leave" | "promote" | "demote",
 *   timestamp: number,
 *   tiktok_id: string,
 *   username: string,
 *   display_name: string,
 *   is_vip: boolean,
 *   avatar_url: string | null
 * }
 */

export function emitQueueEvent(
  type: "join" | "leave" | "promote" | "demote",
  user: any
) {
  const payload = {
    type,
    timestamp: Date.now(),

    // 🔥 direct flatten → overlays lezen evt.username, evt.display_name, evt.avatar_url
    tiktok_id: String(user.tiktok_id),
    username: (user.username || "").replace(/^@+/, "").toLowerCase(),
    display_name: user.display_name || "unknown",
    is_vip: !!user.is_vip,
    avatar_url: user.avatar_url ?? null
  };

  // ------------------------------------------------------------------------
  // 🔥 Emit naar iedereen (admin panel logging, dashboard, devtools)
  // ------------------------------------------------------------------------
  io.emit("queueEvent", payload);

  // ------------------------------------------------------------------------
  // 🔥 Emit alleen naar overlays (OBS)
  // overlays krijgen dit via: socket.join("overlays")
  // ------------------------------------------------------------------------
  io.to("overlays").emit("queueEvent", payload);
}
