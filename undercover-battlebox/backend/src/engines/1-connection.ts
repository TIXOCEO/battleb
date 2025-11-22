// ============================================================================
// 1-connection.ts — v13.0 PRO EDITION
// TikTok LIVE via Render Proxy Sign Server + Euler PRO room resolver
// 100% backward compatible with BattleBox engines
// ============================================================================

import WebSocket from "ws";
import { getSetting, setSetting } from "../db";
import { upsertIdentityFromLooseEvent } from "./2-user-engine";
import { setLiveState } from "../server";

// Node 20 → native fetch aanwezig
// ---------------------------------------------------------------------------
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

// BattleBox hard-lock state
let activeConn: any = null;

// ENV
const EULER_KEY = process.env.EULER_API_KEY || "";
const SIGN_PROXY = "https://battlebox-sign-proxy.onrender.com/sign";

// ============================================================================
// 🔍 ROOM RESOLUTION (Euler PRO)
// ============================================================================
// 1: haal eerst numeric room-id via Euler PRO endpoint
// ---------------------------------------------------------------------------
async function resolveRoomId(username: string) {
  console.log("🟦 [DEBUG] Starting room_id lookup…");

  try {
    const url = `https://tiktok.eulerstream.com/webcast/room_id?uniqueId=${username}`;
    console.log("🔍 [DEBUG] Resolving room_id via:", url);

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "x-api-key": EULER_KEY,
      },
    });

    const json = await res.json();
    console.log("🔍 [DEBUG] Euler /room_id response:", json);

    if (!json.ok || json.is_live !== true) {
      console.log("❌ [DEBUG] Euler reports: user not live or no data");
      return null;
    }

    console.log("🟦 [DEBUG] Lookup result:", json.room_id);
    return json.room_id;
  } catch (err: any) {
    console.log("❌ [DEBUG] Euler room_id error:", err.message);
    return null;
  }
}

// ============================================================================
// 🔐 SIGN WS URL (Render Proxy)
// ============================================================================
// 2: sign de uiteindelijke WS handshake via jouw Render-proxy
// ============================================================================

async function signWebsocketUrl(roomId: string) {
  try {
    const fetchUrl = `https://webcast.tiktok.com/webcast/room/info/?aid=1988&room_id=${roomId}`;

    const res = await fetch(SIGN_PROXY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: fetchUrl,
        method: "GET",
        includeBrowserParams: true,
        includeVerifyFp: true,
      }),
    });

    if (!res.ok) throw new Error("Proxy sign server returned an error");

    const json: any = await res.json();
    const data = json.response || json;

    if (!data.signedUrl) throw new Error("Proxy returned no signedUrl");

    // Zet cookies om in header formaat
    const cookieStr = (data.cookies || [])
      .map((c: any) => `${c.name}=${c.value}`)
      .join("; ");

    return {
      signedUrl: data.signedUrl,
      cookies: cookieStr,
      userAgent:
        data.userAgent ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      requestHeaders: data.requestHeaders || {},
    };
  } catch (err: any) {
    console.error("❌ Sign proxy error:", err?.message);
    return null;
  }
}

// ============================================================================
// 🔌 BROWSER-ACCURATE WS ADAPTER (BattleBox Safe Mode)
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
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
    } catch {}
  }
}

// ============================================================================
// 🚀 START CONNECTION — MAIN ENTRY (BattleBox standard API preserved)
// ============================================================================
export async function startConnection(
  username: string,
  onConnected: () => void
): Promise<{ conn: any | null }> {
  const cleanHost = norm(username);

  console.log(`🔌 Verbinden met TikTok LIVE (Proxy + Euler PRO)… @${cleanHost}`);

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

  // ========================================================================
  // 1: ROOM-ID VIA EULER PRO
  // ========================================================================
  const roomId = await resolveRoomId(cleanHost);
  if (!roomId) {
    console.log("❌ Kon room_id niet ophalen → waarschijnlijk offline");
    return { conn: null };
  }

  // ========================================================================
  // 2: SIGN VIA RENDER PROXY
  // ========================================================================
  const sign = await signWebsocketUrl(roomId);
  if (!sign) {
    console.log("❌ Geen signedUrl → proxy fout");
    return { conn: null };
  }

  const { signedUrl, cookies, userAgent, requestHeaders } = sign;

  const wsHeaders = {
    "User-Agent": userAgent,
    Cookie: cookies,
    ...requestHeaders,
  };

  const conn = new BattleboxTikTokWS(signedUrl, wsHeaders);

  // ========================================================================
  // 3: CONNECT LOOP (BattleBox standaard)
  // ========================================================================
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      await conn.connect();

      console.log(`✔ Verbonden met livestream (proxy) @${cleanHost}`);

      conn.on("connected", async () => {
        setLiveState(true);
        await saveHost(roomId, cleanHost, cleanHost);
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
// 🛑 VERBINDING STOPPEN — unchanged
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
// END FILE — v13.0
// ============================================================================
