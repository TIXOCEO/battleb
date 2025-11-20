// ============================================================================
// 1-connection.ts — v7.1 FINAL
// PERFECT HOST DETECTIE + LIVE STATE + RACE-CONNECT PROTECTIE
// ============================================================================

import { WebcastPushConnection } from "tiktok-live-connector";
import { getSetting, setSetting } from "../db";
import { upsertIdentityFromLooseEvent } from "./2-user-engine";
import { refreshHostUsername } from "./3-gift-engine";
import { setLiveState } from "../server"; // <-- now exists

let activeConn: WebcastPushConnection | null = null;
let connecting = false;

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

// ============================================================================
// START CONNECTION
// ============================================================================

export async function startConnection(
  username: string,
  onConnected: () => void
): Promise<{ conn: WebcastPushConnection | null }> {

  if (connecting) {
    console.log("⏳ Connectie bezig → overslaan");
    return { conn: null };
  }
  connecting = true;

  const cleanHost = norm(username);
  if (!cleanHost) {
    console.error(`❌ Ongeldige host-invoer: "${username}"`);
    connecting = false;
    return { conn: null };
  }

  console.log(`🔌 Verbinden met TikTok LIVE… @${cleanHost}`);

  const conn = new WebcastPushConnection(cleanHost, {
    requestOptions: { timeout: 15000 },
    enableExtendedGiftInfo: true,
  });

  let detectedHostId: string | null = null;
  let detectedUnique: string | null = null;
  let detectedNick: string | null = null;

  let hostSaved = false;
  let connectedFired = false;

  // ========================================================================
  // SAVE HOST (alleen als info COMPLEET is)
  // ========================================================================

  async function saveHost(id: string, unique: string, nickname: string) {
    if (hostSaved) return;
    if (!id || !unique) return; // harde veiligheid

    hostSaved = true;

    const cleanUnique = norm(unique);

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

    console.log("✔ HOST correct opgeslagen");
  }

  // ========================================================================
  // FALLBACK — alleen lezen
  // ========================================================================

  const captureFallback = (raw: any) => {
    if (hostSaved || connectedFired) return;

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

    if (uid) detectedHostId = String(uid);

    const unique = u?.uniqueId || u?.unique_id || null;
    const nick = u?.nickname || u?.displayName || null;

    if (unique) detectedUnique = norm(unique);
    if (nick) detectedNick = nick;
  };

  function attachFallbackListeners(c: any) {
    const evs = [
      "enter",
      "member",
      "social",
      "share",
      "gift",
      "chat",
      "roomMessage",
      "like",
      "follow",
      "subscribe",
      "liveRoomUser",
      "join",
    ];

    for (const ev of evs) {
      try {
        c.on(ev, captureFallback);
      } catch {}
    }

    console.log("🕵️‍♂️ Fallback actief");
  }

  // ========================================================================
  // IDENTITY SYNC
  // ========================================================================

  function attachIdentitySync(c: any) {
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
      "enter",
      "liveRoomUser"
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
  // CONNECT FLOW
  // ========================================================================

  try {
    await conn.connect();
    console.log(`✔ Verbonden met livestream van @${cleanHost}`);

    conn.on("connected", async (info: any) => {
      connectedFired = true;

      console.log("══════════════ CONNECTED ══════════════");

      setLiveState(true);

      const hostId =
        info?.hostId ||
        info?.ownerId ||
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

      console.log("🎯 HOST DETECTIE:", { hostId, unique, nick });

      if (hostId && unique) {
        await saveHost(String(hostId), unique, nick);
      } else {
        console.warn("⚠ CONNECTED gaf geen hostId → fallback actief");
      }

      onConnected();
    });

    attachFallbackListeners(conn);
    attachIdentitySync(conn);

    setTimeout(async () => {
      if (!hostSaved && !connectedFired && detectedHostId) {
        console.log("⚠ FALLBACK HOST:", {
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
    }, 3000);

    activeConn = conn;
    connecting = false;
    return { conn };
  } catch (err: any) {
    console.error("⛔ Verbinding mislukt:", err?.message);
    connecting = false;
    return { conn: null };
  }
}

// ============================================================================
// STOP CONNECTION
// ============================================================================

export async function stopConnection(conn?: WebcastPushConnection | null): Promise<void> {
  const c = conn || activeConn;
  if (!c) return;

  console.log("🔌 Verbinding verbreken…");

  try {
    if (typeof c.disconnect === "function") {
      await c.disconnect();
    } else if (typeof (c as any).close === "function") {
      await (c as any).close();
    }
  } catch (err) {
    console.error("❌ stopConnection fout:", err);
  }

  setLiveState(false);

  if (!conn || conn === activeConn) {
    activeConn = null;
  }

  console.log("🛑 Verbinding verbroken.");
}
