// ============================================================================
// 1-connection.ts — v3.0 (Host-ID Enabled, Stable, Compact Logging)
// TikTok LIVE connector — haalt ECHTE host_id + uniqueId bij "connected"
// ============================================================================

import { WebcastPushConnection } from "tiktok-live-connector";
import pool, { getSetting, setSetting } from "../db";
import { upsertIdentityFromLooseEvent } from "./2-user-engine";
import { refreshHostUsername } from "./3-gift-engine";

// Actieve verbinding
let activeConn: WebcastPushConnection | null = null;

// Helper
const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));


// ============================================================================
// START TIKTOK CONNECTION
// ============================================================================

export async function startConnection(
  username: string,
  onConnected: () => void
): Promise<{ conn: WebcastPushConnection | null }> {
  
  const cleanHost = username.replace(/^@+/, "").trim().toLowerCase();

  if (!cleanHost) {
    console.error(`❌ Ongeldige host: "${username}"`);
    return { conn: null };
  }

  console.log(`🔌 Verbinden met TikTok LIVE… @${cleanHost}`);

  const conn = new WebcastPushConnection(cleanHost, {
    requestOptions: { timeout: 12000 },
    enableExtendedGiftInfo: true,
  });

  // Retry 8x
  for (let i = 1; i <= 8; i++) {
    try {
      await conn.connect();
      console.log(`✔ Verbonden met livestream van @${cleanHost}`);

      // --------------------------------------------------------------------
      // CONNECTED EVENT: HIER KOMT DE ECHTE HOST-ID VAN TIKTOK BINNEN
      // --------------------------------------------------------------------
      conn.on("connected", async (info: any) => {
        console.log("══════════ CONNECTED ══════════");

        try {
          // ECHTE host ID zoeken in TikTok payload
          const hostId =
            info?.hostId ||
            info?.ownerId ||
            info?.roomIdOwner ||
            info?.user?.userId ||
            info?.userId ||
            null;

          const hostUnique =
            info?.uniqueId ||
            info?.ownerUniqueId ||
            info?.user?.uniqueId ||
            cleanHost ||
            null;

          const hostDisplay =
            info?.nickname ||
            info?.ownerNickname ||
            info?.user?.nickname ||
            hostUnique ||
            "Host";

          console.log("🎯 HOST DETECTIE:", {
            id: hostId,
            uniqueId: hostUnique,
            display: hostDisplay,
          });

          if (hostId && hostUnique) {

            // Save host_id
            await setSetting("host_id", String(hostId));

            // Save username WITHOUT @
            await setSetting("host_username", hostUnique.toLowerCase());

            // refresh cache for gift-engine
            await refreshHostUsername();

            // Register host in database users table
            await upsertIdentityFromLooseEvent({
              userId: String(hostId),
              uniqueId: hostUnique,
              nickname: hostDisplay,
            });

            console.log("💾 HOST opgeslagen (host_id + username)");
          } else {
            console.warn("⚠ TikTok gaf geen hostId/uniqueId terug!");
          }
        } catch (err: any) {
          console.error("❌ Host-detectie fout:", err?.message || err);
        }

        onConnected();
      });

      attachIdentityUpdaters(conn);

      activeConn = conn;
      return { conn };

    } catch (err: any) {
      console.error(`⛔ Verbinding mislukt (poging ${i}/8):`, err?.message);

      if (i === 8) {
        console.error(`⚠ @${cleanHost} lijkt offline → IDLE-modus`);
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

  console.log("🔌 Verbreken TikTok-verbinding…");

  try {
    if (typeof c.disconnect === "function") await c.disconnect();
    else if (typeof (c as any).close === "function") await (c as any).close();

    console.log("🛑 Verbinding verbroken.");
  } catch (err) {
    console.error("❌ stopConnection fout:", err);
  }

  if (!conn || conn === activeConn) activeConn = null;
}



// ============================================================================
// IDENTITY SYNC ENGINE
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
    "enter"
  ];

  for (const ev of events) {
    try {
      conn.on(ev, update);
    } catch {}
  }

  // Gifts
  conn.on("gift", (g: any) => {
    update(g);
    if (g?.toUser || g?.receiver) update(g.toUser || g.receiver);
  });

  // Battles
  conn.on("linkMicBattle", (d: any) => {
    if (Array.isArray(d?.battleUsers)) {
      for (const u of d.battleUsers) update(u);
    }
  });

  console.log("👤 Identity engine actief (TikTok → users)");
}
