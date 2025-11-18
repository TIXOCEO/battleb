// ============================================================================
// src/engines/1-connection.ts — v2.0 (Host-AutoDetect, Clean, Stable)
// TikTok LIVE connector — haalt ECHTE host info uit 'connected' event
// ============================================================================

import { WebcastPushConnection } from "tiktok-live-connector";
import { upsertIdentityFromLooseEvent } from "./2-user-engine";
import pool, { getSetting } from "../db";
import { refreshHostUsername } from "./3-gift-engine";

// Actieve verbinding
let activeConn: WebcastPushConnection | null = null;

// Helper: sleep
const wait = (ms: number) => new Promise(res => setTimeout(res, ms));


// ============================================================================
// START TIKTOK CONNECTION
// ============================================================================

export async function startConnection(
  username: string,
  onConnected: () => void
): Promise<{ conn: WebcastPushConnection | null }> {

  const cleanHost = username.replace(/^@+/, "").trim().toLowerCase();

  if (!cleanHost) {
    console.error(`❌ Ongeldige host-invoer: "${username}"`);
    return { conn: null };
  }

  console.log(`🔌 Verbinden met TikTok LIVE … @${cleanHost}`);

  const conn = new WebcastPushConnection(cleanHost, {
    requestOptions: { timeout: 12000 },
    enableExtendedGiftInfo: true,
  });

  // Retry tot 8x
  for (let i = 1; i <= 8; i++) {
    try {
      await conn.connect();
      console.log(`✔ Verbonden met livestream van @${cleanHost}`);

      // ----------------------------------------------------------
      // ON CONNECTED → HIER KOMT ECHTE HOST INFO VAN TIKTOK BINNEN
      // ----------------------------------------------------------
      conn.on("connected", async (info: any) => {
        console.log("═══════════════ CONNECTED ═══════════════");
        console.log(`BATTLEBOX VERBONDEN MET @${cleanHost}`);
        console.log("TikTok geeft nu echte host data…");
        console.log("══════════════════════════════════════════");

        try {
          const hostId =
            info?.hostId ||
            info?.ownerId ||
            info?.roomIdOwner ||
            info?.userId ||
            info?.user?.userId ||
            null;

          const hostUnique =
            info?.uniqueId ||
            info?.ownerUniqueId ||
            info?.user?.uniqueId ||
            null;

          const hostDisplay =
            info?.nickname ||
            info?.ownerNickname ||
            info?.user?.nickname ||
            hostUnique ||
            "Onbekende Host";

          console.log("🎯 TikTok HOST DETECTIE:", {
            id: hostId,
            uniqueId: hostUnique,
            display: hostDisplay,
          });

          if (hostId && hostUnique) {
            // Opslaan in settings
            await pool.query(
              `INSERT INTO settings (key, value)
               VALUES ('host_id', $1)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
              [String(hostId)]
            );

            await pool.query(
              `INSERT INTO settings (key, value)
               VALUES ('host_username', $1)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
              [hostUnique]
            );

            // Immediate cache refresh
            await refreshHostUsername();

            // Registreren als user
            await upsertIdentityFromLooseEvent({
              userId: String(hostId),
              uniqueId: hostUnique,
              nickname: hostDisplay,
            });

            console.log("💾 HOST-AUTO-DETECTED → opgeslagen in DB + cache");
          } else {
            console.warn("⚠ TikTok gaf geen hostId / uniqueId terug!");
          }
        } catch (err: any) {
          console.error("❌ Host-autodetect fout:", err.message || err);
        }

        onConnected();
      });

      // ----------------------------------------------------------
      // Identity synchronisatie (alle events)
      // ----------------------------------------------------------
      attachIdentityUpdaters(conn);

      // Save active conn
      activeConn = conn;
      return { conn };

    } catch (err: any) {
      console.error(`⛔ Verbinding mislukt (poging ${i}/8):`, err.message || err);

      if (i === 8) {
        console.error(`⚠ @${cleanHost} lijkt offline → Engine in IDLE-modus`);
        return { conn: null };
      }

      await wait(6000);
    }
  }

  return { conn: null };
}


// ============================================================================
// STOP CONNECTION
// ============================================================================

export async function stopConnection(
  conn?: WebcastPushConnection | null
): Promise<void> {

  const c = conn || activeConn;
  if (!c) return;

  console.log("🔌 TikTok-verbinding sluiten…");

  try {
    if (typeof c.disconnect === "function") await c.disconnect();
    else if (typeof (c as any).close === "function") await (c as any).close();

    console.log("🛑 Verbinding succesvol gestopt.");
  } catch (err) {
    console.error("❌ stopConnection fout:", err);
  }

  if (!conn || conn === activeConn) activeConn = null;
}


// ============================================================================
// IDENTITY SYNC (alle TikTok events)
// ============================================================================

function attachIdentityUpdaters(conn: any) {
  if (!conn || typeof conn.on !== "function") return;

  const update = (raw: any) =>
    upsertIdentityFromLooseEvent(
      raw?.user || raw?.sender || raw?.toUser || raw?.receiver || raw
    );

  const events = [
    "chat",
    "like",
    "follow",
    "share",
    "member",
    "subscribe",
    "social",
    "liveRoomUser",
    "enter",
  ];

  for (const ev of events) {
    try {
      conn.on(ev, update);
    } catch {}
  }

  conn.on("gift", (g: any) => {
    update(g);
    if (g?.toUser || g?.receiver) update(g.toUser || g.receiver);
  });

  conn.on("linkMicBattle", (d: any) => {
    if (Array.isArray(d?.battleUsers)) {
      for (const u of d.battleUsers) update(u);
    }
  });

  console.log("👤 Identity engine actief (TikTok → users-table)");
}

