// ============================================================================
// queue-events.ts — v16.7 (Sanitized Emission + No Double Emit)
// ============================================================================

import { io } from "./server";

export function emitQueueEvent(
  type: "join" | "leave" | "promote" | "demote",
  user: any
) {
  const usernameClean = (user.username || "").replace(/^@+/, "").toLowerCase();

  const payload = {
    type,
    timestamp: Date.now(),
    tiktok_id: String(user.tiktok_id || ""),
    username: usernameClean || "onbekend",
    display_name: user.display_name || usernameClean || "Onbekend",
    is_vip: !!user.is_vip,
    avatar_url: user.avatar_url ?? null
  };

  io.to("overlays").emit("queueEvent", payload);
}
