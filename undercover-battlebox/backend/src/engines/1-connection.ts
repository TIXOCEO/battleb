// ============================================================================
// src/engines/1-connection.ts — v1.26 (Crash-Safe / Idle Ready / Clean Disconnect)
// TikTok LIVE connector — NOOIT meer process.exit en met NULL-checks
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

  if (!host) {
    console.error(`❌ Ongeldige host: "${username}"`);
    return { conn: null };
  }

  const conn = new WebcastPushConnection(host, {
    requestOptions: { timeout: 15000 },
    enableExtendedGiftInfo: true,
  });

  console.log("VERBINDEN MET TIKTOK… @" + host);

  for (let i = 0; i < 8; i++) {
    try {
      await conn.connect();
      console.log(`✔ Verbonden met TikTok livestream van @${host}`);

      // OnConnected event listener
      conn.on("connected", () => {
        console.log("=".repeat(80));
        console.log(`BATTLEBOX – VERBONDEN MET @${host}`);
        console.log("Alle events worden nu verwerkt.");
        console.log("=".repeat(80));
        onConnected();
      });

      // Identity syncs
      attachIdentityUpdaters(conn);

      // Giftlist helper
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
    } catch (err: any) {
      console.error(
        `⛔ Verbinding mislukt (poging ${i + 1}/8):`,
        err?.message || err
      );

      if (i === 7) {
        console.error(
          `⚠ @${host} is offline → Engine IDLE-modus (geen events)`
        );
        return { conn: null };
      }

      await new Promise((res) => setTimeout(res, 7000)); // retry delay
    }
  }

  return { conn: null };
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
  if (!conn || typeof conn.on !== "function") return;

  const update = (d: any) =>
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);

  const events = [
    "chat",
    "like",
    "follow",
    "social",
    "member",
    "subscribe",
    "moderator",
    "liveRoomUser",
  ];

  events.forEach((event) => {
    try {
      conn.on(event, update);
    } catch {}
  });

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
