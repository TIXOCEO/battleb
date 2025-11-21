// ============================================================================
// euler-to-chat.ts — v1.0 Adapter
// Converts Euler "chat" events → BattleBox ChatEngine
// ============================================================================

import { processChatMessage } from "./6-chat-engine";

function norm(v: any) {
  return (v || "").toString().trim().replace(/^@+/, "").toLowerCase();
}

export function processChatEuler(data: any) {
  if (!data) return;

  const sender = data.sender || data.user;

  const msg = {
    text: data.comment || data.text || "",
    userId: sender?.user_id || sender?.id || "",
    uniqueId: norm(sender?.unique_id || sender?.uniqueId),
    nickname: sender?.nickname || "",
    raw: data,
  };

  try {
    processChatMessage(msg);
  } catch (err) {
    console.error("❌ processChatEuler:", err);
  }
}
