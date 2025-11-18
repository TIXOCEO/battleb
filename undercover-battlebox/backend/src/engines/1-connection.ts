// ============================================================================
// 1-connection.ts — v3.5 (Host-ID Perfect, Fallback Recovery, Deep Debug)
// TikTok LIVE connector — Onderdeel van Undercover BattleBox
// ============================================================================

import { WebcastPushConnection } from "tiktok-live-connector";
import pool, { getSetting, setSetting } from "../db";
import { upsertIdentityFromLooseEvent } from "./2-user-engine";
import { refreshHostUsername } from "./3-gift-engine";

// ──────────────────────────────────────────────────────────────
// ACTIVE CONNECTION
// ──────────────────────────────────────────────────────────────
let activeConn: WebcastPushConnection | null = null;

// Simple sleep
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Same normalizer as gift-engine
function normalize(v: any): string {
  return (v || "")
    .toString()
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]/gu, "");
}

// ============================================================================
// START CONNECTION
// ============================================================================

export async function startConnection(
  username: string,
  onConnected: () => void
): Promise<{ conn: WebcastPushConnection | null }> {
  const cleanHost = normalize(username);

  if (!cleanHost) {
    console.error(`❌ Ongeldige host-invoer: "${username}"`);
    return { conn: null };
  }

  console.log(`🔌 Verbinden met TikTok LIVE… @${cleanHost}`);

  const conn = new WebcastPushConnection(cleanHost, {
    requestOptions: { timeout: 12000 },
    enableExtendedGiftInfo: true,
  });

  // We bouwen een backup: als TikTok geen host_id geeft in "connected",
  // detecteren we host alsnog via eerste events (enter/member/roomUser).
  let hostSet = false;

  // We onthouden de laatste mogelijke host_id gezien in andere events
  let fallbackHostId: string | null = null;
  let fallbackUniqueId: string | null = null;
  let fallbackNickname: string | null = null;

  // ──────────────────────────────────────────────────────────────
  //  CONNECT — 8 RETRIES
  // ──────────────────────────────────────────────────────────────
  for (let i = 1; i <= 8; i++) {
    try {
      await conn.connect();
      console.log(`✔ Verbonden met livestream van @${cleanHost}`);

      // ======================================================================
      //  MAIN CONNECTED EVENT — ECHTE HOST-ID KOMT HIER
      // ======================================================================
      conn.on("connected", async (info: any) => {
        console.log("══════════ CONNECTED ══════════");

        try {
          const hostId =
            info?.hostId ||
            info?.ownerId ||
            info?.roomIdOwner ||
            info?.user?.userId ||
            info?.userId ||
            null;

          const uniqueId =
            info?.uniqueId ||
            info?.ownerUniqueId ||
            info?.user?.uniqueId ||
            cleanHost ||
            null;

          const nickname =
            info?.nickname ||
            info?.ownerNickname ||
            info?.user?.nickname ||
            uniqueId ||
            "Host";

          console.log("🎯 HOST DETECTIE via CONNECTED:", {
            id: hostId,
            uniqueId,
            nickname,
          });

          if (hostId && uniqueId) {
            await saveHostToDB(hostId, uniqueId, nickname);
            hostSet = true;
          } else {
            console.warn("⚠ CONNECTED event bevatte GEEN host_id → fallback actief");
          }
        } catch (err: any) {
          console.error("❌ Host-detectie fout:", err?.message || err);
        }

        onConnected();
      });

      // ======================================================================
      // FALLBACK HOST DETECTIE
      // Als binnen 2–3 sec geen host_id via "connected" → detecteer via events
      // ======================================================================
      const fallbackDetector = async (raw: any) => {
        if (hostSet) return;

        const u =
          raw?.user ||
          raw?.sender ||
          raw?.toUser ||
          raw?.receiver ||
          raw;

        if (!u) return;

        const uid =
          u?.userId ||
          u?.id ||
          u?.uid ||
          null;

        const uniqueId = u?.uniqueId || null;
        const nickname = u?.nickname || null;

        // Alleen verwerken als UID lijkt op een host (stream owners hebben meestal early enter)
        if (uid) {
          fallbackHostId = String(uid);
          fallbackUniqueId = normalize(uniqueId || cleanHost);
          fallbackNickname = nickname || fallbackUniqueId;
        }
      };

      // Aan alle identity events koppelen (voor fallback)
      attachFallbackListeners(conn, fallbackDetector);

      // Na 3 seconden checken of hostSet == false → fallback gebruiken
      setTimeout(async () => {
        if (!hostSet && fallbackHostId) {
          console.log("⚠ Fallback host detectie gebruikt!", {
            id: fallbackHostId,
            uniqueId: fallbackUniqueId,
            nickname: fallbackNickname,
          });

          await saveHostToDB(
            fallbackHostId,
            fallbackUniqueId!,
            fallbackNickname!
          );

          hostSet = true;
          onConnected();
        }
      }, 3000);

      // Identity updaters voor users-table
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
// SAVE HOST IN DB
// ============================================================================

async function saveHostToDB(hostId: string, uniqueId: string, nickname: string) {
  const cleanUnique = normalize(uniqueId);

  console.log("💾 HOST SAVE:", {
    id: hostId,
    username: cleanUnique,
    nickname,
  });

  // Opslaan in settings
  await setSetting("host_id", String(hostId));
  await setSetting("host_username", cleanUnique);

  // Host direct naar users-table
  await upsertIdentityFromLooseEvent({
    userId: String(hostId),
    uniqueId: cleanUnique,
    nickname,
  });

  // Gift-engine cache verversen
  await refreshHostUsername();

  console.log("✔ HOST volledig opgeslagen + users-table geüpdatet");
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
// IDENTITY UPDATING
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

  console.log("👤 Identity-engine actief (live user updates)");
}

// ============================================================================
// FALLBACK LISTENERS — alleen gebruikt vóór hostSet=true
// ============================================================================

function attachFallbackListeners(conn: any, cb: (raw: any) => void) {
  const fallbackEvents = [
    "enter",
    "member",
    "liveRoomUser",
    "social",
    "share",
    "gift",
    "chat",
  ];

  for (const ev of fallbackEvents) {
    try {
      conn.on(ev, cb);
    } catch {}
  }

  console.log("🕵️‍♂️ Fallback-host-detectie listeners actief");
}

