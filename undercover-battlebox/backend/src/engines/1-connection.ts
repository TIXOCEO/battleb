// ============================================================================
// 1-connection.ts — v11 SAFE MODE
// Undercover BattleBox — TikTok LIVE Core Connection Engine
// SAFE HOST LOCK + SAFE CONNECT + NO SIGN SPAM
// ============================================================================

import { WebcastPushConnection } from "tiktok-live-connector";
import { getSetting, setSetting } from "../db";
import { upsertIdentityFromLooseEvent } from "./2-user-engine";
import { setLiveState } from "../server";

// ============================================================================
// HELPERS
// ============================================================================
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function norm(v: any): string {
  return (v || "")
    .toString()
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/gi, "")
    .slice(0, 30);
}

// Actieve verbinding
let activeConn: WebcastPushConnection | null = null;
let isIdle = true;

// ============================================================================
// START CONNECTION — SAFE MODE (no loops)
// ============================================================================
export async function startConnection(
  username: string,
  onConnected: () => void
): Promise<{ conn: WebcastPushConnection | null }> {
  
  const cleanHost = norm(username);
  console.log(`🔌 Verbinden met TikTok LIVE… @${cleanHost}`);

  // Als systeem idle is omdat admin dat wilt → nooit automatisch verbinden
  if (!cleanHost || cleanHost.length < 2) {
    console.log("⚠ Geen geldige host ingesteld → IDLE");
    isIdle = true;
    return { conn: null };
  }

  isIdle = false;

  const conn = new WebcastPushConnection(cleanHost, {
    requestOptions: { timeout: 15000 },
    enableExtendedGiftInfo: true,
  });

  let connectedFired = false;
  let hostSaved = false;

  // ------------------------------------------------------------------------
  // HOST SAVE FUNCTION
  // ------------------------------------------------------------------------
  async function saveHost(id: string, uniqueId: string, nickname: string) {
    if (!id || hostSaved) return;
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

    console.log("✔ HOST definitief vastgelegd (HARD LOCK)");
  }

  // ------------------------------------------------------------------------
  // FALLBACK CAPTURE (alleen ter detectie)
  // ------------------------------------------------------------------------
  function captureFallback(raw: any) {
    if (connectedFired || hostSaved) return;
    const u =
      raw?.user ||
      raw?.sender ||
      raw?.receiver ||
      raw?.toUser ||
      raw?.userIdentity ||
      raw;

    if (!u) return;

    const uid =
      u?.userId ||
      u?.id ||
      u?.uid ||
      raw?.receiverUserId ||
      raw?.toUserId ||
      null;

    const unique = u?.uniqueId || u?.unique_id || null;
    const nick = u?.nickname || u?.displayName || null;

    if (uid && unique) {
      saveHost(String(uid), unique, nick || unique);
      onConnected(); // fallback accepted
    }
  }

  function attachFallbackListeners(c: any) {
    const events = [
      "enter",
      "member",
      "gift",
      "chat",
      "like",
      "follow",
      "subscribe",
      "share",
      "join",
      "roomMessage",
      "liveRoomUser",
      "social",
    ];
    for (const ev of events) {
      try {
        c.on(ev, captureFallback);
      } catch {}
    }
    console.log("🕵️‍♂️ Fallback actief (alleen detectie)");
  }

  // ------------------------------------------------------------------------
  // IDENTITY SYNC
  // ------------------------------------------------------------------------
  function attachIdentitySync(c: any) {
    const update = (raw: any) => {
      upsertIdentityFromLooseEvent(
        raw?.user ||
          raw?.sender ||
          raw?.receiver ||
          raw?.toUser ||
          raw?.userIdentity ||
          raw
      );
    };

    const base = [
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
    for (const ev of base) {
      try {
        c.on(ev, update);
      } catch {}
    }

    c.on("gift", (g: any) => {
      update(g);
      if (g?.toUser) update(g.toUser);
      if (g?.receiver) update(g.receiver);
    });

    c.on("linkMicBattle", (d: any) => {
      if (Array.isArray(d?.battleUsers)) {
        for (const u of d.battleUsers) update(u);
      }
    });

    console.log("👤 Identity-engine actief");
  }

  // ------------------------------------------------------------------------
  // *** 1× CONNECT TRY — NO RETRIES ***
  // ------------------------------------------------------------------------
  try {
    await conn.connect();
  } catch (err: any) {
    console.error("❌ Verbinden mislukt:", err?.message);
    console.log("⚠ Host waarschijnlijk offline → IDLE MODE");
    isIdle = true;
    setLiveState(false);
    return { conn: null };
  }

  console.log(`✔ Verbonden met livestream van @${cleanHost}`);

  // ------------------------------------------------------------------------
  // CONNECTED EVENT
  // ------------------------------------------------------------------------
  conn.on("connected", async (info: any) => {
    connectedFired = true;

    console.log("══════════ CONNECTED ══════════");

    setLiveState(true);

    const hostId =
      info?.hostId ||
      info?.ownerId ||
      info?.roomIdOwner ||
      info?.user?.userId ||
      info?.userId ||
      null;

    const unique =
      info?.uniqueId ||
      info?.ownerUniqueId ||
      info?.user?.uniqueId ||
      cleanHost;

    const nick =
      info?.nickname ||
      info?.ownerNickname ||
      info?.user?.nickname ||
      unique;

    console.log("🎯 CONNECTED HOST DETECTIE:", {
      hostId,
      unique,
      nick,
    });

    if (hostId) {
      await saveHost(String(hostId), unique, nick);
    }

    onConnected();
  });

  attachFallbackListeners(conn);
  attachIdentitySync(conn);

  // ------------------------------------------------------------------------
  // DISCONNECT → één reconnect-poging → anders IDLE
  // ------------------------------------------------------------------------
  conn.on("disconnected", async () => {
    console.log("🔻 Verbinding verbroken — poging tot één reconnect…");

    try {
      await conn.connect();
      console.log("🔄 Reconnect gelukt");
      return;
    } catch (err) {
      console.log("⛔ Reconnect mislukt → IDLE MODE");
      isIdle = true;
      setLiveState(false);
      activeConn = null;
      return;
    }
  });

  activeConn = conn;
  return { conn };
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
    await c.disconnect();
  } catch (err) {
    console.error("❌ stopConnection fout:", err);
  }

  setLiveState(false);
  activeConn = null;
  isIdle = true;
}

// ============================================================================
// END
// ============================================================================
