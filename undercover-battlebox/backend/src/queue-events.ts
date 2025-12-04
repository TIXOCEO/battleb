// ============================================================================
// queue-events.ts — v16.6 FIXED (NO DOUBLE EMIT)
// ============================================================================

import { io } from "./server";

export function emitQueueEvent(
  type: "join" | "leave" | "promote" | "demote",
  user: any
) {
  const payload = {
    type,
    timestamp: Date.now(),
    tiktok_id: String(user.tiktok_id),
    username: (user.username || "").replace(/^@+/, "").toLowerCase(),
    display_name: user.display_name || "unknown",
    is_vip: !!user.is_vip,
    avatar_url: user.avatar_url ?? null
  };

  // ✔ ONLY overlays receive queueEvent
  io.to("overlays").emit("queueEvent", payload);

  // ✔ Admins get logs via separate system, not queueEvent duplication
}
