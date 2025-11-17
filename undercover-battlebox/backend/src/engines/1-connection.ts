// ============================================================================
// src/engines/1-connection.ts — v1.25 (Crash-Safe / Idle Mode)
// TikTok LIVE connector — NOOIT meer process.exit
// ============================================================================

import { WebcastPushConnection } from "tiktok-live-connector";
import { upsertIdentityFromLooseEvent } from "./2-user-engine";

// Globale actieve verbinding
let activeConn: WebcastPushConnection | null = null;

// ============================================================================
// TikTok verbinden (met retries, maar nooit crashen)
// ============================================================================

export async function startConnection(
  username: string,
  onConnected: () => void
): Promise<{ conn: WebcastPushConnection | null }> {
  const host = username.replace(/^@+/, "").trim();

  const conn = new WebcastPushConnection(host, {
    requestOptions: { timeout: 15000 },
    enableExtendedGiftInfo: true,
  });

  console.log("VERBINDEN MET TIKTOK… @" + host);

  let connected = false;

  for (let i = 0; i < 8; i++) {
    try {
      await conn.connect();
      console.log(`✔ Verbonden met TikTok livestream van @${host}`);
      connected = true;
      break;
    } catch (err: any) {
      console.error(
        `⛔ Verbinding mislukt (poging ${i + 1}/8):`,
        err?.message || err
      );

      // laatste poging → stop connectie maar crash niet
      if (i === 7) {
        console.error(
          `⚠ @${host} lijkt offline → TikTok-engine in IDLE-modus`
        );
        return { conn: null };
      }

      // wacht en probeer opnieuw
      await new Promise((res) => setTimeout(res, 7000));
    }
  }

  if (!connected) return { conn: null };

  conn.on("connected", () => {
    console.log("=".repeat(80));
    console.log(`BATTLEBOX – VERBONDEN MET @${host}`);
    console.log("Alle events komen binnen — gift engine actief");
    console.log("=".repeat(80));
    onConnected();
  });

  // Identiteit-updates koppelen
  attachIdentityUpdaters(conn);

  // Gifts-lijst functie
  (conn as any).getAvailableGifts = async () => {
    try {
      const giftsObj = (conn as any).availableGifts;
      if (!giftsObj || typeof giftsObj !== "object") return [];
      return Object.values(giftsObj);
    } catch {
      return [];
    }
  };

  activeConn = conn;
  return { conn };
}

// ============================================================================
// Verbinding stoppen
// ============================================================================

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

    console.log("🛑 TikTok verbinding gestopt.");
  } catch (err) {
    console.error("❌ Fout bij stopConnection:", err);
  } finally {
    if (!conn || conn === activeConn) activeConn = null;
  }
}

// ============================================================================
// Identity sync vanuit TikTok events
// ============================================================================

function attachIdentityUpdaters(conn: any) {
  const update = (d: any) =>
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);

  conn.on("chat", update);
  conn.on("like", update);
  conn.on("follow", update);
  conn.on("social", update);
  conn.on("member", update);
  conn.on("subscribe", update);
  conn.on("moderator", update);
  conn.on("liveRoomUser", update);

  conn.on("gift", (d: any) => {
    update(d);
    if (d?.toUser || d?.receiver) {
      update(d?.toUser || d?.receiver);
    }
  });

  conn.on("linkMicBattle", (d: any) => {
    if (d?.battleUsers) {
      for (const u of d.battleUsers) update(u);
    }
  });

  console.log("[IDENTITY ENGINE] TikTok identity updates actief");
}
