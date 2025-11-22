// ============================================================================
// 1-connection.ts — v12.3 PRO EDITION (Euler RoomID + Proxy Signing + Debug)
// Full TikTok LIVE Connection Engine (no removed logic, only additions)
// ============================================================================

import WebSocket from "ws";
import { getSetting, setSetting } from "../db";
import { upsertIdentityFromLooseEvent } from "./2-user-engine";
import { setLiveState } from "../server";

// Debug helper
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
// STEP 0 — Username → room_id (Euler API, ultra-stable)
// ============================================================================
async function getRoomIdFromUsername(username: string): Promise<string | null> {
  try {
    console.log(`🔍 [DEBUG] Resolving room_id for @${username} via Euler /room_id`);

    const lookupUrl = `https://tiktok.eulerstream.com/webcast/room_id?uniqueId=${username}`;

    const res = await fetch(lookupUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      },
    });

    const json: any = await res.json();

    console.log("🔍 [DEBUG] Euler /room_id response:", json);

    if (!json.ok) {
      console.log("❌ [DEBUG] Euler reports: user not live or no data");
      return null;
    }

    const roomId =
      json.room_id ||
      json?.data?.room_id ||
      json?.response?.room_id ||
      null;

    console.log("🎯 [DEBUG] Euler resolved room_id:", roomId);

    return roomId;
  } catch (err: any) {
    console.error("❌ [DEBUG] getRoomIdFromUsername error:", err.message);
    return null;
  }
}

// ============================================================================
// STEP 1 — SIGN HTTP REQUEST VIA PROXY SIGN SERVER
// ============================================================================
async function getSignedUrl(roomId: string) {
  try {
    console.log("🟦 [DEBUG] Requesting signedUrl from Proxy…");

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

    const json: any = await res.json();
    console.log("🟦 [DEBUG] Proxy response:", json);

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
    console.error("❌ [DEBUG] Sign proxy error:", err.message);
    return null;
  }
}

// ============================================================================
// STEP 2 — FETCH REAL WEBSOCKET URL (TikTok Browser Flow)
// ============================================================================
async function getRealWebsocketUrl(
  signedUrl: string,
  userAgent: string,
  cookies: string
) {
  try {
    console.log("🟪 [DEBUG] Fetching room_info via signedUrl…");

    // 1) GET room_info
    const infoRes = await fetch(signedUrl, {
      headers: {
        "User-Agent": userAgent,
        Cookie: cookies,
      },
    });

    const infoJson: any = await infoRes.json();
    console.log("🟪 [DEBUG] room_info response:", infoJson);

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

    // 2) Build fetch URL
    const fetchUrl = `https://webcast.tiktok.com/webcast/fetch/?aid=1988&room_id=${roomId}&cursor=${cursor}`;

    console.log("🟪 [DEBUG] Fetch URL:", fetchUrl);

    // 3) Sign fetch URL
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
    console.log("🟪 [DEBUG] Signed fetch response:", signedFetchJson);

    const f = signedFetchJson.response || signedFetchJson;

    const fetchCookies = (f.cookies || [])
      .map((c: any) => `${c.name}=${c.value}`)
      .join("; ");

    // 4) Fetch final WS URL
    const wsRes = await fetch(f.signedUrl, {
      headers: {
        "User-Agent": f.userAgent,
        Cookie: fetchCookies,
      },
    });

    const wsJson: any = await wsRes.json();
    console.log("🟪 [DEBUG] Final fetch result:", wsJson);

    const wsUrl =
      wsJson?.data?.ws_url ??
      wsJson?.data?.push_server ??
      wsJson?.ws_url ??
      wsJson?.push_server ??
      "";

    return wsUrl;
  } catch (err: any) {
    console.error("❌ [DEBUG] Fout bij ophalen WebSocket URL:", err.message);
    return null;
  }
}

// ============================================================================
// WS ADAPTER (unchanged except more debug)
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
      console.log("📡 [DEBUG] Opening WebSocket:", this.url);

      this.ws = new WebSocket(this.url, { headers: this.headers });
      const sock = this.ws as any;

      sock.on("open", () => {
        console.log("📡 [DEBUG] WebSocket connected");
        this.emit("connected", {});
        resolve();
      });

      sock.on("message", (buf: any) => {
        try {
          const msg = JSON.parse(buf.toString());
          upsertIdentityFromLooseEvent(msg.data || msg);

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
        } catch (e) {
          console.error("⚠️ [DEBUG] WS parse error:", e);
        }
      });

      sock.on("error", (e: any) => {
        console.error("❌ [DEBUG] WS ERROR:", e.message);
        reject(e);
      });

      sock.on("close", () => {
        console.log("🔌 [DEBUG] WS CLOSED");
        this.emit("disconnect", {});
      });
    });
  }

  async disconnect() {
    try {
      if (this.ws && (this.ws as any).readyState === WebSocket.OPEN) {
        console.log("🔌 [DEBUG] Closing WebSocket…");
        (this.ws as any).close();
      }
    } catch {}
  }
}

// ============================================================================
// START CONNECTION — v12.3 DEBUG MODE
// ============================================================================
export async function startConnection(
  username: string,
  onConnected: () => void
): Promise<{ conn: any | null }> {
  const cleanHost = norm(username);

  console.log(`🔌 Verbinden met TikTok LIVE… @${cleanHost}`);
  console.log("🟦 [DEBUG] Starting room_id lookup…");

  // STEP 0 — resolve username → room_id via Euler
  const resolvedRoomId = await getRoomIdFromUsername(cleanHost);

  console.log("🟦 [DEBUG] Lookup result:", resolvedRoomId);

  if (!resolvedRoomId) {
    console.log("❌ Kon room_id niet ophalen → waarschijnlijk offline");
    return { conn: null };
  }

  let hostSaved = false;

  async function saveHost(id: string, uniqueId: string, nickname: string) {
    if (hostSaved) return;
    hostSaved = true;

    await setSetting("host_id", String(id));
    await setSetting("host_username", norm(uniqueId));

    await upsertIdentityFromLooseEvent({
      userId: String(id),
      uniqueId: norm(uniqueId),
      nickname,
    });

    console.log("✔ HOST opgeslagen (HARD LOCK)");
  }

  // STEP 1 — Sign
  console.log("🟦 [DEBUG] Requesting SIGN…");

  const sign = await getSignedUrl(resolvedRoomId);
  if (!sign) {
    console.log("❌ SignedUrl mislukt → host offline?");
    return { conn: null };
  }

  const { signedUrl, userAgent, cookies, requestHeaders } = sign;

  const wsHeaders = {
    "User-Agent": userAgent,
    Cookie: cookies,
    ...requestHeaders,
  };

  // STEP 2 — Real WebSocket URL
  console.log("🟪 [DEBUG] Getting REAL WebSocket URL…");

  const wsUrl = await getRealWebsocketUrl(signedUrl, userAgent, cookies);

  console.log("🟪 [DEBUG] WS URL:", wsUrl);

  if (!wsUrl) {
    console.log("❌ Geen WebSocket URL → offline?");
    return { conn: null };
  }

  const conn = new BattleboxTikTokWS(wsUrl, wsHeaders);

  // CONNECT LOOP
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      console.log(`🔄 [DEBUG] WS connect attempt ${attempt}/8`);
      await conn.connect();

      console.log(`✔ Verbonden met livestream @${cleanHost}`);

      conn.on("connected", async () => {
        setLiveState(true);
        await saveHost(resolvedRoomId, cleanHost, cleanHost);
        onConnected();
      });

      activeConn = conn;
      return { conn };
    } catch (err: any) {
      console.error(`⛔ Verbinding mislukt (${attempt}/8):`, err.message);
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
