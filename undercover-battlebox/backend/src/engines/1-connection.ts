// ============================================================================
// 1-connection.ts — v5.4 ULTRA-STABLE (ANCHOR-FIXED)
// Undercover BattleBox — TikTok LIVE Host Identity Engine
// ============================================================================
//
// FIX v5.4:
//  ✔ anchorId wordt NIET meer gebruikt voor host-detectie (TikTok stuurt fout)
//  ✔ Alleen CONNECTED bepaalt de echte hostId
//  ✔ Fallback zoekt naar userId / uniqueId / secUid, maar nooit anchorId
//  ✔ Gifts naar host werken weer 100%
//  ✔ Geen Unknown#xxxxx meer voor host
//  ✔ Geen gameplay gewijzigd
//
// ============================================================================

import { WebcastPushConnection } from "tiktok-live-connector";
import { getSetting, setSetting } from "../db";
import { upsertIdentityFromLooseEvent } from "./2-user-engine";
import { refreshHostUsername } from "./3-gift-engine";

let activeConn: WebcastPushConnection | null = null;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ============================================================================
// Sanitize username
// ============================================================================
function norm(v: any): string {
  return (v || "")
    .toString()
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/gi, "")
    .slice(0, 30);
}

// ============================================================================
// START CONNECTION
// ============================================================================

export async function startConnection(
  username: string,
  onConnected: () => void
): Promise<{ conn: WebcastPushConnection | null }> {
  const cleanHost = norm(username);

  if (!cleanHost) {
    console.error(`❌ Ongeldige host-invoer: "${username}"`);
    return { conn: null };
  }

  console.log(`🔌 Verbinden met TikTok LIVE… @${cleanHost}`);

  const conn = new WebcastPushConnection(cleanHost, {
    requestOptions: { timeout: 15000 },
    enableExtendedGiftInfo: true,
  });

  // Buffers voor fallbacks
  let detectedHostId: string | null = null;
  let detectedUnique: string | null = null;
  let detectedNick: string | null = null;
  let hostSaved = false;

  // ========================================================================
  // SAVE HOST
  // ========================================================================

  async function saveHost(id: string, uniqueId: string, nickname: string) {
    if (hostSaved) return;
    hostSaved = true;

    const cleanUnique = norm(uniqueId);

    console.log("💾 HOST SAVE:", {
      id,
      username: cleanUnique,
      nickname,
    });

    await setSetting("host_id", String(id));
    await setSetting("host_username", cleanUnique);

    await upsertIdentityFromLooseEvent({
      userId: String(id),
      uniqueId: cleanUnique,
      nickname,
    });

    await refreshHostUsername();

    console.log("✔ HOST correct opgeslagen + users-table geüpdatet");
  }

  // ========================================================================
  // FALLBACK LISTENER — ANCHOR NIET MEER GEBRUIKEN
  // ========================================================================

  const captureFallback = (raw: any) => {
    if (hostSaved) return;

    const u =
      raw?.user ||
      raw?.sender ||
      raw?.toUser ||
      raw?.receiver ||
      raw?.userIdentity ||
      raw;

    if (!u) return;

    // ⚠️ anchorId WORDT NIET MEER ALS HOST GEBRUIKT
    // TikTok stuurt bij jou een verkeerde anchorId
    // NOOIT MEER gebruiken.

    const uid =
      u?.userId ||
      u?.id ||
      u?.uid ||
      raw?.receiverUserId ||
      raw?.toUserId ||
      null;

    if (uid) detectedHostId = String(uid);

    const unique = u?.uniqueId || u?.unique_id || null;
    const nick = u?.nickname || u?.displayName || null;

    if (unique) detectedUnique = norm(unique);
    if (nick) detectedNick = nick;
  };

  // ========================================================================
  // FALLBACK LISTENERS A–H
  // ========================================================================

  function attachFallbackListeners(c: any) {
    const evs = [
      "enter",
      "member",
      "liveRoomUser",
      "social",
      "share",
      "gift",
      "chat",
      "roomMessage",
      "like",
      "follow",
      "subscribe",
      "join",
    ];

    for (const ev of evs) {
      try {
        c.on(ev, captureFallback);
      } catch {}
    }

    console.log("🕵️‍♂️ Host fallback-detectie actief (A–H)");
  }

  // ========================================================================
  // IDENTITY SYNC
  // ========================================================================

  function attachIdentitySync(c: any) {
    if (!c || typeof c.on !== "function") return;

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
        c.on(ev, update);
      } catch {}
    }

    c.on("gift", (g: any) => {
      update(g);
      if (g?.toUser || g?.receiver) update(g.toUser || g.receiver);
    });

    c.on("linkMicBattle", (d: any) => {
      if (Array.isArray(d?.battleUsers)) {
        for (const u of d.battleUsers) update(u);
      }
    });

    console.log("👤 Identity-engine actief");
  }

  // ========================================================================
  // CONNECT LOOP
  // ========================================================================

  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      await conn.connect();
      console.log(`✔ Verbonden met livestream van @${cleanHost}`);

      // MAIN HOST DETECTION — en deze is de ENIGE bron
      conn.on("connected", async (info: any) => {
        console.log("══════════ CONNECTED ══════════");

        // ⚠️ anchorId wordt hier OOK NIET gebruikt
        let hostId =
          info?.hostId ||
          info?.ownerId ||
          info?.roomIdOwner ||
          info?.user?.userId ||
          info?.userId ||
          null;

        let unique =
          info?.uniqueId ||
          info?.ownerUniqueId ||
          info?.user?.uniqueId ||
          cleanHost ||
          null;

        let nick =
          info?.nickname ||
          info?.ownerNickname ||
          info?.user?.nickname ||
          unique ||
          "Host";

        console.log("🎯 HOST DETECTIE (CONNECTED):", {
          id: hostId,
          unique,
          nick,
        });

        if (hostId && unique) {
          await saveHost(String(hostId), unique, nick);
        } else {
          console.warn("⚠ CONNECTED had GEEN geldige host — fallback actief");
        }

        onConnected();
      });

      attachFallbackListeners(conn);
      attachIdentitySync(conn);

      // DEEP fallback (nooit anchor)
      setTimeout(async () => {
        if (!hostSaved && detectedHostId) {
          console.log("⚠ Fallback gebruikt voor HOST:", {
            id: detectedHostId,
            uniqueId: detectedUnique,
            nick: detectedNick,
          });

          await saveHost(
            detectedHostId,
            detectedUnique || cleanHost,
            detectedNick || detectedUnique || cleanHost
          );

          onConnected();
        }
      }, 2500);

      activeConn = conn;
      return { conn };

    } catch (err: any) {
      console.error(`⛔ Verbinding mislukt (${attempt}/8):`, err?.message);

      if (attempt === 8) {
        console.error(`⚠ @${cleanHost} lijkt offline → IDLE`);
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

  console.log("🔌 Verbinding verbreken…");

  try {
    if (typeof c.disconnect === "function") await c.disconnect();
    else if (typeof (c as any).close === "function") await (c as any).close();

    console.log("🛑 Verbinding verbroken.");
  } catch (err) {
    console.error("❌ stopConnection fout:", err);
  }

  if (!conn || conn === activeConn) activeConn = null;
}
