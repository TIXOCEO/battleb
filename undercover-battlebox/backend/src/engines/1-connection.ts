// ============================================================================
// 1-connection.ts — v12.2 PRO EDITION (Browser-Accurate TikTok WS Engine)
// TikTok LIVE via Proxy Sign Server + Username → room_id resolver
// SAFE UPGRADES ONLY — No removals of existing logic
// ============================================================================

import WebSocket from "ws";
import { getSetting, setSetting } from "../db";
import { upsertIdentityFromLooseEvent } from "./2-user-engine";
import { setLiveState } from "../server";

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

let activeConn: any = null;

// ============================================================================
// STEP 0 — Username → Numerical room_id (TikTok API)
// ============================================================================
async function getRoomIdFromUsername(username: string): Promise<string | null> {
  try {
    const lookupUrl = `https://www.tiktok.com/api/live/detail/?aid=1988&unique_id=${username}`;

    const res = await fetch(lookupUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      },
    });

    if (!res.ok) return null;

    const json: any = await res.json();

    const roomId =
      json?.data?.liveRoom?.room_id_str ||
      json?.data?.liveRoom?.room_id ||
      null;

    return roomId;
  } catch (err: any) {
    console.error("❌ getRoomIdFromUsername error:", err.message);
    return null;
  }
}

// ============================================================================
// STEP 1 — SIGN HTTP REQUEST VIA PROXY
// ============================================================================
async function getSignedUrl(roomId: string) {
  try {
    const targetUrl = `https://webcast.tiktok.com/webcast/room/info/?aid=1988&room_id=${roomId}`;

    const res = await fetch("https://battlebox-sign-proxy.onrender.com/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: targetUrl,
        method: "GET",
        includeBrowserParams: true,
        includeVerifyFp: true,
      }),
    });

    if (!res.ok) throw new Error("Proxy sign server returned HTTP error");

    const json: any = await res.json();
    const data = json.response || json;

    if (!data.signedUrl) throw new Error("Proxy did not return signedUrl");

    const cookieStr = (data.cookies || [])
      .map((c: any) => `${c.name}=${c.value}`)
      .join("; ");

    return {
      signedUrl: data.signedUrl,
      userAgent: data.userAgent || "Mozilla/5.0",
      cookies: cookieStr,
      requestHeaders: data.requestHeaders || {},
    };
  } catch (err: any) {
    console.error("❌ Sign proxy error:", err?.message);
    return null;
  }
}

// ============================================================================
// STEP 2 — FETCH REAL WEBSOCKET URL (Browser Flow)
// ============================================================================
async function getRealWebsocketUrl(
  signedUrl: string,
  userAgent: string,
  cookies: string
) {
  try {
    // 1) room/info signed
    const infoRes = await fetch(signedUrl, {
      headers: {
        "User-Agent": userAgent,
        Cookie: cookies,
      },
    });

    const infoJson: any = await infoRes.json();

    const cursor =
      infoJson?.data?.cursor ??
      infoJson?.cursor ??
      infoJson?.data?.next_cursor ??
      "";

    const roomId =
      infoJson?.data?.id_str ??
      infoJson?.data?.room_id ??
      infoJson?.room_id ??
      "";

    if (!roomId) throw new Error("RoomId ontbreekt");

    // 2) fetch URL
    const fetchUrl = `https://webcast.tiktok.com/webcast/fetch/?aid=1988&room_id=${roomId}&cursor=${cursor}`;

    // 3) opnieuw signen
    const signedFetch = await fetch(
      "https://battlebox-sign-proxy.onrender.com/sign",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: fetchUrl,
          method: "GET",
          includeBrowserParams: true,
          includeVerifyFp: true,
        }),
      }
    );

    const signedFetchJson: any = await signedFetch.json();
    const f = signedFetchJson.response || signedFetchJson;

    const fetchCookies = (f.cookies || [])
      .map((c: any) => `${c.name}=${c.value}`)
      .join("; ");

    // 4) GET actual fetch result
    const wsRes = await fetch(f.signedUrl, {
      headers: {
        "User-Agent": f.userAgent,
        Cookie: fetchCookies,
      },
    });

    const wsJson: any = await wsRes.json();

    const wsUrl =
      wsJson?.data?.ws_url ??
      wsJson?.data?.push_server ??
      wsJson?.ws_url ??
      wsJson?.push_server ??
      "";

    if (!wsUrl || !wsUrl.startsWith("wss://"))
      throw new Error("Geen geldige WebSocket URL gevonden");

    return wsUrl;
  } catch (err: any) {
    console.error("❌ Fout bij ophalen WebSocket URL:", err.message);
    return null;
  }
}

// ============================================================================
// WS ADAPTER  (NO REMOVALS, ONLY SAFE CASTS)
// ============================================================================
class BattleboxTikTokWS {
  ws: WebSocket | null = null;
  handlers: Record<string, Function[]> = {};

  constructor(public url: string, public headers: any) {}

  on(event: string, fn: Function) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(fn);
  }

  emit(event: string, data: any) {
    const arr = this.handlers[event];
    if (arr) for (const fn of arr) fn(data);
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url, { headers: this.headers });
      const sock = this.ws as any;

      sock.on("open", () => {
        this.emit("connected", {});
        resolve();
      });

      sock.on("message", (buf: any) => {
        try {
          const msg = JSON.parse(buf.toString());
          const type = msg?.type || "";

          switch (type) {
            case "webcastGiftMessage":
              this.emit("gift", msg.data || msg);
              break;
            case "webcastChatMessage":
              this.emit("chat", msg.data || msg);
              break;
            case "webcastMemberMessage":
              this.emit("member", msg.data || msg);
              break;
            case "webcastRoomMessage":
              this.emit("roomMessage", msg.data || msg);
              break;
          }

          upsertIdentityFromLooseEvent(msg.data || msg);
        } catch {}
      });

      sock.on("error", (e: any) => reject(e));
      sock.on("close", () => this.emit("disconnect", {}));
    });
  }

  async disconnect() {
    try {
      if (this.ws && (this.ws as any).readyState === WebSocket.OPEN) {
        (this.ws as any).close();
      }
    } catch {}
  }
}

// ============================================================================
// START CONNECTION — minimal safe modifications
// ============================================================================
export async function startConnection(
  username: string,
  onConnected: () => void
): Promise<{ conn: any | null }> {
  const cleanHost = norm(username);

  console.log(`🔌 Verbinden met TikTok LIVE (PROXY)… @${cleanHost}`);

  // STEP 0 — resolve username → room_id
  const resolvedRoomId = await getRoomIdFromUsername(cleanHost);

  if (!resolvedRoomId) {
    console.log("❌ Kon room_id niet ophalen → waarschijnlijk offline");
    return { conn: null };
  }

  console.log(`🔍 Resolved room_id = ${resolvedRoomId}`);

  let hostSaved = false;

  async function saveHost(id: string, uniqueId: string, nickname: string) {
    if (hostSaved) return;
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

  // STEP 1 — Sign HTTP
  const sign = await getSignedUrl(resolvedRoomId);
  if (!sign) {
    console.log("❌ Signed URL mislukt → host offline?");
    return { conn: null };
  }

  const { signedUrl, userAgent, cookies, requestHeaders } = sign;

  const wsHeaders = {
    "User-Agent": userAgent,
    Cookie: cookies,
    ...requestHeaders,
  };

  // STEP 2 — get REAL WS URL
  const wsUrl = await getRealWebsocketUrl(signedUrl, userAgent, cookies);
  if (!wsUrl) {
    console.log("❌ Geen WebSocket URL gevonden → LIVE offline?");
    return { conn: null };
  }

  console.log("📡 WebSocket URL:", wsUrl);

  const conn = new BattleboxTikTokWS(wsUrl, wsHeaders);

  // CONNECT LOOP
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      await conn.connect();

      console.log(`✔ Verbonden met livestream (proxy) @${cleanHost}`);

      conn.on("connected", async () => {
        setLiveState(true);
        await saveHost(resolvedRoomId, cleanHost, cleanHost);
        onConnected();
      });

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
export async function stopConnection(conn?: any | null): Promise<void> {
  const c = conn || activeConn;
  if (!c) return;

  console.log("🔌 Verbinding verbreken…");

  try {
    await c.disconnect();
  } catch (err) {
    console.error("❌ stopConnection fout:", err);
  }

  setLiveState(false);

  if (!conn || conn === activeConn) activeConn = null;
}

// ============================================================================
// END FILE
// ============================================================================
