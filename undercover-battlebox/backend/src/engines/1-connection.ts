// src/engines/1-connection.ts — v0.7.1
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

// Huidige actieve TikTok-verbinding, zodat we hem netjes kunnen stoppen
let activeConn: WebcastPushConnection | null = null;

// ─────────────────────────────────────────────────────────────
// TikTok verbinden met retry
// ─────────────────────────────────────────────────────────────

export async function startConnection(
  username: string,
  onConnected: () => void
) {
  const host = username.replace(/^@+/, "").trim();
  const conn = new WebcastPushConnection(host, {
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

  // ─────────────────────────────────────────────
  // ✔ HIER TOEGEVOEGD → OFFICIËLE GIFTS-LIJST FUNCTIE
  // ─────────────────────────────────────────────
// Voeg getAvailableGifts toe via een veilige cast
;(conn as any).getAvailableGifts = async () => {
  try {
    const giftsObj = (conn as any).availableGifts;

    if (!giftsObj || typeof giftsObj !== "object") {
      console.error("⚠️ availableGifts bestaat niet of is leeg");
      return [];
    }

    // Maak van het object een array
    return Object.values(giftsObj);
  } catch (err) {
    console.error("❌ Fout in getAvailableGifts:", err);
    return [];
  }
};


  // ─────────────────────────────────────────────

  // Actieve connectie opslaan zodat we hem kunnen stoppen bij host-wissel
  activeConn = conn;

  return { conn };
}

// ─────────────────────────────────────────────────────────────
// Verbinding netjes stoppen (voor host-wissel / shutdown)
// ─────────────────────────────────────────────────────────────

export async function stopConnection(
  conn?: WebcastPushConnection | null
): Promise<void> {
  const c = conn || activeConn;
  if (!c) return;

  try {
    console.log("🔌 TikTok verbinding wordt afgesloten…");
    if (typeof c.disconnect === "function") {
      await c.disconnect();
    } else if (typeof (c as any).close === "function") {
      await (c as any).close();
    }
    console.log("🛑 TikTok verbinding succesvol gestopt.");
  } catch (err) {
    console.error("❌ Fout bij stopConnection:", err);
  } finally {
    if (!conn || conn === activeConn) {
      activeConn = null;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Identity Updaters — de kern van jouw systeem
// ─────────────────────────────────────────────────────────────

function attachIdentityUpdaters(conn: any) {

  attachIdentityUpdaters(conn);

// Voeg getAvailableGifts toe via een veilige cast
;(conn as any).getAvailableGifts = async () => {
    ...
};
  
  // 1) Chat
  conn.on("chat", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);
  });

  // 2) Likes
  conn.on("like", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);
  });

  // 3) Follow
  conn.on("follow", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);
  });

  // 4) Social
  conn.on("social", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);
  });

  // 5) Member (join)
  conn.on("member", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d);
  });

  // 6) Subscribe
  conn.on("subscribe", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);
  });

  // 7) Moderator
  conn.on("moderator", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d);
  });

  // 8) Gift
  conn.on("gift", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);
    if (d?.toUser || d?.receiver) {
      upsertIdentityFromLooseEvent(d?.toUser || d?.receiver);
    }
  });

  // 9) Mic battle user info
  conn.on("linkMicBattle", (d: any) => {
    if (d?.battleUsers) {
      for (const u of d.battleUsers) {
        upsertIdentityFromLooseEvent(u);
      }
    }
  });

  // 10) liveRoomUser → enters
  conn.on("liveRoomUser", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d);
  });

  console.log(
    "[IDENTITY ENGINE] Running (chat/like/follow/social/member/gift/subscribe/moderator/battle)"
  );
}
