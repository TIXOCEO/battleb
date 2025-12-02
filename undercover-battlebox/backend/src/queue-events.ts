import { io } from "./server";

export function emitQueueEvent(type: "join"|"leave"|"promote"|"demote", user: any) {
  io.emit("queueEvent", {
    type,
    timestamp: Date.now(),
    user: {
      tiktok_id: String(user.tiktok_id),
      username: user.username,
      display_name: user.display_name,
      is_vip: !!user.is_vip
    }
  });
}
