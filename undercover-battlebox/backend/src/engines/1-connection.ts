// src/engines/1-connection.ts — v0.7.0
// TikTok LIVE webcast connector
//
// Doelen:
//  - Stabiele connectie met automatische retries
//  - Live identity-updates uit ALLE eventtypes
//  - Supersterke samenwerking met 2-user-engine.ts
//  - Minimaliseert “Onbekend” tijd tot < 1 seconde
//  - Real-time verversen van display_name & username
//
// BELANGRIJK: altijd buiten gift-engine om identities updaten
// zodat host-detection en gift mapping *optimaal* werkt.

import { WebcastPushConnection } from "tiktok-live-connector";
import { upsertIdentityFromLooseEvent } from "./2-user-engine";

// ─────────────────────────────────────────────────────────────
// TikTok verbinden met retry
// ─────────────────────────────────────────────────────────────

export async function startConnection(
  username: string,
  onConnected: () => void
) {
  const host = username.replace(/^@+/, "").trim();
  const conn = new WebcastPushConnection(host, {
    // TikTok stuurt soms halve user-objecten.
    // Deze opties verhogen reliability.
    requestOptions: {
      timeout: 15000,
    },
    enableExtendedGiftInfo: true,
  });

  console.log("VERBINDEN MET TIKTOK… @" + host);

  // Max 8 retries (± 50 sec)
  for (let i = 0; i < 8; i++) {
    try {
      await conn.connect();
      console.log(`Verbonden met TikTok livestream van @${host}`);
      break;
    } catch (err: any) {
      console.error(
        `⛔ Verbinding mislukt (poging ${i + 1}/8):`,
        err?.message || err
      );
      if (i === 7) {
        console.error("GEEN VERBINDING MOGELIJK → STOP SERVER");
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 7000));
    }
  }

  conn.on("connected", () => {
    console.log("=".repeat(80));
    console.log("BATTLEBOX LIVE – VERBONDEN MET @" + host);
    console.log("Alle inkomende events → identity-updates");
    console.log("Gift-engine gebruikt deze identiteiten realtime");
    console.log("=".repeat(80));
    onConnected();
  });

  // IDENTITEITEN SNEL UPDATEN
  attachIdentityUpdaters(conn);

  return { conn };
}

// ─────────────────────────────────────────────────────────────
// Identity Updaters — de kern van jouw systeem
//
// DIT IS WAAR jij Onbekend oplost.
//
// Elk event bevat user-info. Zodra TikTok iets beters stuurt,
// wordt de database onmiddellijk geüpdatet.
// ─────────────────────────────────────────────────────────────

function attachIdentityUpdaters(conn: any) {
  // 1) Chat (beste event, komt het snelst binnen)
  conn.on("chat", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);
  });

  // 2) Likes (ook superfrequent)
  conn.on("like", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);
  });

  // 3) Follow
  conn.on("follow", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);
  });

  // 4) Social / share
  conn.on("social", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);
  });

  // 5) Member (join / viewer joined)
  conn.on("member", (d: any) => {
    // TikTok stuurt hier heel vaak real-nicknames!
    upsertIdentityFromLooseEvent(d?.user || d);
  });

  // 6) Subscribe
  conn.on("subscribe", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);
  });

  // 7) Live moderator events (optioneel)
  conn.on("moderator", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d);
  });

  // 8) Gift events → update zowel sender als ontvanger
  conn.on("gift", (d: any) => {
    // Sender
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);

    // Receiver (cohost/speler/host)
    if (d?.toUser || d?.receiver) {
      upsertIdentityFromLooseEvent(d?.toUser || d?.receiver);
    }
  });

  // 9) Mic changes (soms bevatten deelnemers info)
  conn.on("linkMicBattle", (d: any) => {
    if (d?.battleUsers) {
      for (const u of d.battleUsers) {
        upsertIdentityFromLooseEvent(u);
      }
    }
  });

  // 10) Live room entry / guest enter → bevat user object
  conn.on("liveRoomUser", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d);
  });

  console.log("[IDENTITY ENGINE] Running (chat/like/follow/social/member/gift/subscribe/moderator/battle)");
}
