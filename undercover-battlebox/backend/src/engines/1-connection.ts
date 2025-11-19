// ============================================================================
// 1-connection.ts — v5.3 ULTRA-STABLE
// Undercover BattleBox — TikTok LIVE Host Identity Engine
// ============================================================================
//
// Features v5.3:
//  ✔ Perfecte host-detectie met anchorId → hostId → uniqueId → nickname
//  ✔ Volledige fallback-detectie op ALLE TikTok event categorieën
//  ✔ Safe sanitizer: geen emoji, max 30 chars, a–z 0–9 . _ -
//  ✔ Geen dubbele host-saves
//  ✔ Host wordt direct in DB + settings geplaatst
//  ✔ Samenwerking met user-engine v2.2 en gift-engine v6.1
//  ✔ Zero breakage, geen gameplay code aangeraakt
//
// ============================================================================

import { WebcastPushConnection } from "tiktok-live-connector";
import pool, { getSetting, setSetting } from "../db";
import { upsertIdentityFromLooseEvent } from "./2-user-engine";
import { refreshHostUsername } from "./3-gift-engine";

let activeConn: WebcastPushConnection | null = null;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ============================================================================
// Sanitize username (uniqueId)
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

  // Buffers voor host detectie
  let detectedHostId: string | null = null;
  let detectedUnique: string | null = null;
  let detectedNick: string | null = null;
  let hostSaved = false;

  // ========================================================================
  // Save host
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

    // Save in settings
    await setSetting("host_id", String(id));
    await setSetting("host_username", cleanUnique);

    // Update users table
    await upsertIdentityFromLooseEvent({
      userId: String(id),
      uniqueId: cleanUnique,
      nickname,
    });

    // Cache voor gift-engine vernieuwen
    await refreshHostUsername();

    console.log("✔ HOST correct opgeslagen + users-table geüpdatet");
  }

  // ========================================================================
  // Fallback listener
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

    // anchorId = hoogste prioriteit fallback
    if (raw?.anchorId) detectedHostId = String(raw.anchorId);

    const uid =
      u?.userId ||
      u?.id ||
      u?.uid ||
      raw?.receiverUserId ||
      raw?.toUserId ||
      raw?.anchorId ||
      null;

    if (uid) detectedHostId = String(uid);

    const unique = u?.uniqueId || u?.unique_id || null;
    const nick = u?.nickname || u?.displayName || null;

    if (unique) detectedUnique = norm(unique);
    if (nick) detectedNick = nick;
  };

  // ========================================================================
  // Attach fallback listeners A–H
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
  // Identity sync voor ALLE events
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

    // Gift heeft dubbele structuur
    c.on("gift", (g: any) => {
      update(g);
      if (g?.toUser || g?.receiver) update(g.toUser || g.receiver);
    });

    // Battles
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

      // CONNECTED event
      conn.on("connected", async (info: any) => {
        console.log("══════════ CONNECTED ══════════");

        let hostId =
          info?.anchorId ||
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

        console.log("🎯 HOST DETECTIE via CONNECTED:", {
          id: hostId,
          unique,
          nick,
        });

        if (hostId && unique) {
          await saveHost(String(hostId), unique, nick);
        } else {
          console.warn(
            "⚠ CONNECTED bevat GEEN geldige host_id → fallback zal host vinden"
          );
        }

        onConnected();
      });

      // Activate fallback listeners
      attachFallbackListeners(conn);

      // Activate identity sync
      attachIdentitySync(conn);

      // Deep fallback na 2.5 sec
      setTimeout(async () => {
        if (!hostSaved && detectedHostId) {
          console.log("⚠ Fallback gebruikt!", {
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
      console.error(
        `⛔ Verbinding mislukt (poging ${attempt}/8):`,
        err?.message
      );

      if (attempt === 8) {
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

  console.log("🔌 Verbeken TikTok-verbinding…");

  try {
    if (typeof c.disconnect === "function") await c.disconnect();
    else if (typeof (c as any).close === "function") await (c as any).close();

    console.log("🛑 Verbinding verbroken.");
  } catch (err) {
    console.error("❌ stopConnection fout:", err);
  }

  if (!conn || conn === activeConn) activeConn = null;
}
