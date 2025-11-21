// ============================================================================
// 1-connection.ts — v11.3 BUILD-SAFE PROXY WS EDITION
// TikTok LIVE via Proxy Sign Server + Native WS Adapter
// SAFE for TypeScript (no RawData, no null errors)
// ============================================================================

import WebSocket from "ws";
import { getSetting, setSetting } from "../db";
import { upsertIdentityFromLooseEvent } from "./2-user-engine";
import { setLiveState } from "../server";

// wait util
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
// SIGN PROXY REQUEST
// ============================================================================
async function getSignedUrl(cleanHost: string) {
  try {
    const res = await fetch(
      `https://battlebox-sign-proxy.onrender.com/sign?username=${cleanHost}`
    );

    if (!res.ok) throw new Error("Proxy sign server returned error");
    const json: any = await res.json();

    if (!json.signedUrl) throw new Error("Proxy did not return signedUrl");

    return {
      signedUrl: json.signedUrl,
      userAgent: json.userAgent || "Mozilla/5.0",
      cookies: json.cookies || ""
    };
  } catch (err: any) {
    console.error("❌ Sign proxy error:", err?.message);
    return null;
  }
}

// ============================================================================
// WS ADAPTER (BUILD-SAFE VERSION)
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

      const sock = this.ws as any; // build-safe cast

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
      sock.on("error", (e: any) => {
        reject(e);
      });

      // CLOSE
      sock.on("close", () => {
        this.emit("disconnect", {});
      });
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
// START CONNECTION
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

  // SIGN URL
  const sign = await getSignedUrl(cleanHost);
  if (!sign) {
    console.log("❌ Geen signedUrl → host lijkt offline");
    return { conn: null };
  }

  const { signedUrl, userAgent, cookies } = sign;

  const conn = new BattleboxTikTokWS(signedUrl, {
    "User-Agent": userAgent,
    Cookie: cookies,
  });

  // CONNECT LOOP
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      await conn.connect();

      console.log(`✔ Verbonden met livestream (proxy) @${cleanHost}`);

      conn.on("connected", async () => {
        setLiveState(true);

        // PROXY geeft geen echte hostId → we koppelen via nickname
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
