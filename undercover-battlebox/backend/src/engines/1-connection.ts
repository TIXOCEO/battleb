// ============================================================================
// 1-connection.ts — v12.0 PRO EDITION (Safe upgrades, no removals)
// TikTok LIVE via Proxy Sign Server + Browser-Accurate WS Adapter
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
// PRO SIGN REQUEST (Browser-accurate flow)
// ============================================================================
async function getSignedUrl(cleanHost: string) {
  try {
    const targetUrl = `https://webcast.tiktok.com/webcast/room/info/?aid=1988&room_id=${cleanHost}`;

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

    // Correct JSON-structuur uit Euler
    const data = json.response || json;

    if (!data.signedUrl) throw new Error("Proxy did not return signedUrl");

    // Cookies array → Cookie header
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
// WS ADAPTER (no removals, only safe upgrades)
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

      // OPEN
      sock.on("open", () => {
        this.emit("connected", {});
        resolve();
      });

      // MESSAGE
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

      // ERROR
      sock.on("error", (e: any) => reject(e));

      // CLOSE
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
// START CONNECTION (only required improvements)
// ============================================================================
export async function startConnection(
  username: string,
  onConnected: () => void
): Promise<{ conn: any | null }> {
  const cleanHost = norm(username);

  console.log(`🔌 Verbinden met TikTok LIVE (PROXY)… @${cleanHost}`);

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

  // SIGN
  const sign = await getSignedUrl(cleanHost);
  if (!sign) {
    console.log("❌ Geen signedUrl → host lijkt offline");
    return { conn: null };
  }

  const { signedUrl, userAgent, cookies, requestHeaders } = sign;

  // Combineer headers veilig
  const wsHeaders = {
    "User-Agent": userAgent,
    Cookie: cookies,
    ...requestHeaders, // extra headers van Euler → cruciaal
  };

  const conn = new BattleboxTikTokWS(signedUrl, wsHeaders);

  // CONNECT LOOP
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      await conn.connect();

      console.log(`✔ Verbonden met livestream (proxy) @${cleanHost}`);

      conn.on("connected", async () => {
        setLiveState(true);
        await saveHost("0", cleanHost, cleanHost);
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
// STOP CONNECTION (unchanged)
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

// =====================================================================
