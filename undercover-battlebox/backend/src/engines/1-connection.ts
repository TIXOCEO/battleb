// ============================================================================
// 1-connection.ts — v11.0 PROXY SIGN EDITION
// Undercover BattleBox — TikTok LIVE Core Connection Engine
// Replaces WebcastPushConnection with Sign-Proxy + Native WS Adapter
// No game logic touched. No identity logic touched. No fallback overrides.
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

// ============================================================================
// GLOBAL
// ============================================================================
let activeConn: any = null;

// ============================================================================
// SIGN PROXY CALLER
// ============================================================================
async function getSignedUrl(cleanHost: string) {
  try {
    const res = await fetch(
      "https://battlebox-sign-proxy.onrender.com/sign",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: cleanHost })
      }
    );

    if (!res.ok) throw new Error("Proxy sign server returned error");

    const json = await res.json();

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
// WS ADAPTER
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
    if (this.handlers[event]) {
      for (const fn of this.handlers[event]) fn(data);
    }
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url, { headers: this.headers });

      this.ws.on("open", () => {
        this.emit("connected", {});
        resolve();
      });

      this.ws.on("message", (buf: any) => {
        try {
          const msg = JSON.parse(buf.toString());
          const type = msg?.type || "";

          switch (type) {
            case "webcastGiftMessage":
              this.emit("gift", msg?.data || msg);
              break;

            case "webcastChatMessage":
              this.emit("chat", msg?.data || msg);
              break;

            case "webcastMemberMessage":
              this.emit("member", msg?.data || msg);
              break;

            case "webcastRoomMessage":
              this.emit("roomMessage", msg?.data || msg);
              break;

            default:
              break;
          }

          upsertIdentityFromLooseEvent(msg?.data || msg);

        } catch (e) {
          // ignore decode errors
        }
      });

      this.ws.on("error", (e) => {
        reject(e);
      });

      this.ws.on("close", () => {
        this.emit("disconnect", {});
      });
    });
  }

  async disconnect() {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
    } catch (e) {}
  }
}

// ============================================================================
// START CONNECTION (STRICT HOST LOCK)
// ============================================================================
export async function startConnection(
  username: string,
  onConnected: () => void
): Promise<{ conn: any | null }> {
  const cleanHost = norm(username);

  console.log(`🔌 Verbinden met TikTok LIVE (PROXY)… @${cleanHost}`);

  let hostSaved = false;

  async function saveHost(id: string, uniqueId: string, nickname: string) {
    if (!id) return;
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

  // FETCH SIGNED URL
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

  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      await conn.connect();

      console.log(`✔ Verbonden met livestream (proxy) @${cleanHost}`);

      conn.on("connected", async () => {
        setLiveState(true);

        // PROXY geeft host info meestal mee in append
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
