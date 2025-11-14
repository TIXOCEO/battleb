// src/engines/6-chat-engine.ts
// CHAT ENGINE — v1.0
//
// Voorbereid voor chat commands:
//  - !join
//  - !leave
//  - !boost 1-5
//  - !stats
//  - custom commands
//
// Geen functionaliteit actief, alleen detectie/logging.
// Wordt automatisch geladen in server.ts

import { emitLog } from "../server";
import { upsertIdentityFromLooseEvent } from "./2-user-engine";

export function initChatEngine(conn: any) {
  console.log("💬 CHAT ENGINE v1.0 LOADED");

  conn.on("chat", async (data: any) => {
    const msg = data?.comment || "";

    // Upsert identity
    await upsertIdentityFromLooseEvent(data);

    // Still log it
    emitLog({
      type: "system",
      message: `[CHAT] ${data?.nickname || "??"}: ${msg}`,
    });

    // Command detection (nog niets actief)
    if (msg.startsWith("!")) {
      emitLog({
        type: "system",
        message: `[COMMAND DETECTED] ${msg}`,
      });
    }
  });
}
