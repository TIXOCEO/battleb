// src/engines/1-connection.ts — v0.7.1
// TikTok LIVE webcast connector

import { WebcastPushConnection } from "tiktok-live-connector";
import { upsertIdentityFromLooseEvent } from "./2-user-engine";

let activeConn: WebcastPushConnection | null = null;

// ─────────────────────────────────────────────
// TikTok verbinden met retry
// ─────────────────────────────────────────────

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

  // Max 8 retries
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

  // Identity updates
  attachIdentityUpdaters(conn);

  // ─────────────────────────────────────────────────────────────
  // ✔ OFFICIËLE GIFTS-LIJST FUNCTIE (compatibel met jouw versie)
  // ─────────────────────────────────────────────────────────────
  (conn as any).getAvailableGifts = async () => {
    try {
      const giftsObj = (conn as any).availableGifts;

      if (!giftsObj || typeof giftsObj !== "object") {
        console.error("⚠️ availableGifts bestaat niet of is leeg");
        return [];
      }

      return Object.values(giftsObj);
    } catch (err) {
      console.error("❌ Fout in getAvailableGifts:", err);
      return [];
    }
  };

  // Actieve verbinding onthouden
  activeConn = conn;

  return { conn };
}

// ─────────────────────────────────────────────
// Verbinding stoppen
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// Identity Updaters
// ─────────────────────────────────────────────

function attachIdentityUpdaters(conn: any) {
  conn.on("chat", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);
  });

  conn.on("like", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);
  });

  conn.on("follow", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);
  });

  conn.on("social", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);
  });

  conn.on("member", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d);
  });

  conn.on("subscribe", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);
  });

  conn.on("moderator", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d);
  });

  conn.on("gift", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);
    if (d?.toUser || d?.receiver) {
      upsertIdentityFromLooseEvent(d?.toUser || d?.receiver);
    }
  });

  conn.on("linkMicBattle", (d: any) => {
    if (d?.battleUsers) {
      for (const u of d.battleUsers) {
        upsertIdentityFromLooseEvent(u);
      }
    }
  });

  conn.on("liveRoomUser", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d);
  });

  console.log(
    "[IDENTITY ENGINE] Running (chat/like/follow/social/member/gift/subscribe/moderator/battle)"
  );
}
