// ============================================================================
// 1-connection.ts — v9.0 FINAL
// Undercover BattleBox — TikTok LIVE Core Connection Engine
// STRICT HOST LOCK + AUTO HOST-ID RECOVERY + NO MIS-HOSTS EVER AGAIN
// ============================================================================

import { WebcastPushConnection } from "tiktok-live-connector";
import { getSetting, setSetting } from "../db";
import { upsertIdentityFromLooseEvent } from "./2-user-engine";
import { setHostId, setLiveState } from "../server";

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

// ============================================================================
// START CONNECTION
// ============================================================================
export async function startConnection(
  username: string,
  onConnected: () => void
): Promise<{ conn: WebcastPushConnection | null }> {
  const cleanHost = norm(username);

  console.log(`🔌 Verbinden met TikTok LIVE… @${cleanHost}`);

  const conn = new WebcastPushConnection(cleanHost, {
    requestOptions: { timeout: 15000 },
    enableExtendedGiftInfo: true,
  });

  let hostSaved = false;
  let connectedFired = false;

  // fallback capture buffers
  let fb_hostId: string | null = null;
  let fb_unique: string | null = null;
  let fb_nick: string | null = null;

  // ========================================================================
  // SAVE HOST (Only the *real* host)
  // ========================================================================
  async function saveHost(id: string, uniqueId: string, nickname: string) {
    if (!id) return;
    if (hostSaved) return;
    hostSaved = true;

    const cleanUnique = norm(uniqueId);

    console.log("💾 HOST SAVE:", {
      id,
      username: cleanUnique,
      nickname,
    });

    // Save in DB
    await setSetting("host_id", String(id));
    await setSetting("host_username", cleanUnique);

    // Save in server runtime
    setHostId(String(id));

    // Ensure users table has clean entry
    await upsertIdentityFromLooseEvent({
      userId: String(id),
      uniqueId: cleanUnique,
      nickname,
    });

    console.log("✔ HOST is definitief opgeslagen & users-table up-to-date");
  }

  // ========================================================================
  // FALLBACK CAPTURE (but cannot override a connected host)
  // ========================================================================
  function captureFallback(raw: any) {
    if (connectedFired || hostSaved) return; // CONNECTED = always stronger than fallback

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

    if (uid) fb_hostId = String(uid);
    if (unique) fb_unique = norm(unique);
    if (nick) fb_nick = nick;
  }

  function attachFallbackListeners(c: any) {
    const evs = [
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

    for (const ev of evs) {
      try {
        c.on(ev, captureFallback);
      } catch {}
    }

    console.log("🕵️‍♂️ Fallback actief (host wordt NOOIT vervangen)");
  }

  // ========================================================================
  // IDENTITY SYNC — full automatic cleanup
  // ========================================================================
  function attachIdentitySync(c: any) {
    if (!c || typeof c.on !== "function") return;

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

      // STRICT fallback → allowed only if fallback unique == host
      setTimeout(async () => {
        if (!connectedFired && !hostSaved) {
          if (fb_unique === cleanHost && fb_hostId) {
            console.log("⚠ STRICT FALLBACK (host verified):", {
              id: fb_hostId,
              unique: fb_unique,
              nick: fb_nick,
            });

            await saveHost(
              fb_hostId,
              fb_unique || cleanHost,
              fb_nick || fb_unique || cleanHost
            );

            onConnected();
          } else {
            console.log("⛔ Fallback genegeerd — uniekeId ≠ host");
          }
        }
      }, 3000);

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
  } catch (err) {
    console.error("❌ stopConnection fout:", err);
  }

  setLiveState(false);

  if (!conn || conn === activeConn) activeConn = null;
}

// ============================================================================
// END FILE
// ============================================================================
