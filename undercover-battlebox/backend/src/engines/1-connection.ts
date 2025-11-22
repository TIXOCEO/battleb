// ============================================================================
// 1-connection.ts — v12 SAFE MODE
// Undercover BattleBox — TikTok LIVE Core Connection Engine
// SINGLE CONNECT → SINGLE RECONNECT → ELSE IDLE
// SAFE MODE: No health monitor, no retry spam, no fallback loops
// ============================================================================

import { WebcastPushConnection } from "tiktok-live-connector";
import { setSetting } from "../db";
import { upsertIdentityFromLooseEvent } from "./2-user-engine";
import { setLiveState } from "../server";

// small helper
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

let activeConn: WebcastPushConnection | null = null;

// exported getter for outside systems
export function getActiveConn() {
  return activeConn;
}

// ============================================================================
// START CONNECTION — SAFE MODE
// ============================================================================
export async function startConnection(
  username: string,
  onError: () => void
): Promise<{ conn: WebcastPushConnection | null }> {

  const cleanHost = norm(username);
  console.log(`🔌 Verbinden met TikTok LIVE… @${cleanHost}`);

  const conn = new WebcastPushConnection(cleanHost, {
    requestOptions: { timeout: 15000 },
    enableExtendedGiftInfo: true,
  });

  let connected = false;
  let hostSaved = false;

  async function saveHost(id: string, uniqueId: string, nickname: string) {
    if (!id || hostSaved) return;
    hostSaved = true;

    const cleanUnique = norm(uniqueId);

    console.log("💾 HOST SAVE:", { id, username: cleanUnique, nickname });

    await setSetting("host_id", String(id));
    await setSetting("host_username", cleanUnique);

    await upsertIdentityFromLooseEvent({
      userId: String(id),
      uniqueId: cleanUnique,
      nickname,
    });

    console.log("✔ HOST definitief vastgelegd (HARD LOCK)");
  }

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
      "chat", "like", "follow", "share", "member",
      "subscribe", "social", "liveRoomUser", "enter"
    ];
    for (const ev of base) {
      try { c.on(ev, update); } catch {}
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

  // ---------------------------------------------------------
  // 1) Single connect attempt
  // ---------------------------------------------------------
  try {
    await conn.connect();
  } catch (err: any) {
    console.error("❌ Verbinden mislukt:", err?.message);
    console.log("⚠ Host waarschijnlijk offline → IDLE MODE");
    setLiveState(false);
    activeConn = null;
    return { conn: null };
  }

  // ---------------------------------------------------------
  // CONNECTED event
  // ---------------------------------------------------------
  conn.on("connected", async (info: any) => {
    connected = true;

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

    console.log("🎯 HOST DETECTIE:", { hostId, unique, nick });

    if (hostId) {
      await saveHost(String(hostId), unique, nick);
    }
  });

  attachIdentitySync(conn);

  // ---------------------------------------------------------
  // 2) Single reconnect attempt on real disconnect
  // ---------------------------------------------------------
  conn.on("disconnected", async () => {
    console.log("🔻 Verbinding verbroken — poging tot 1 reconnect…");

    try {
      await conn.connect();
      console.log("🔄 Reconnect gelukt");
      return;
    } catch (err) {
      console.log("⛔ Reconnect mislukt → IDLE MODE");
      setLiveState(false);
      activeConn = null;
      onError(); // notify server
      return;
    }
  });

  activeConn = conn;
  return { conn };
}

// ============================================================================
// STOP CONNECTION
// ============================================================================
export async function stopConnection(conn?: WebcastPushConnection | null) {
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
}
