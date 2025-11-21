// ============================================================================
// 1-connection.ts — v11.1 PROXY SIGN EDITION (SAFE TYPES)
// Undercover BattleBox — TikTok LIVE Core Connection Engine
// Replaces WebcastPushConnection with Sign-Proxy + Native WS Adapter
// ============================================================================

// --- FIX 1: Types voor ws (anders TS klaagt) -------------------------------
declare module "ws";

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
// SIGN PROXY CALLER (typesafe)
// ============================================================================

interface SignProxyResponse {
  signedUrl: string;
  userAgent?: string;
  cookies?: string;
}

async function getSignedUrl(cleanHost: string): Promise<SignProxyResponse | null> {
  try {
    const res = await fetch("https://battlebox-sign-proxy.onrender.com/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: cleanHost }),
    });

    if (!res.ok) throw new Error("Proxy sign server returned error");

    const json = (await res.json()) as unknown;

    // --- FIX 2: json unknown → typed check -------------------
    if (
      typeof json !== "object" ||
      json === null ||
      !("signedUrl" in json) ||
      typeof (json as any).signedUrl !== "string"
    ) {
      throw new Error("Proxy returned invalid structure");
    }

    const j = json as any;

    return {
      signedUrl: j.signedUrl,
      userAgent: typeof j.userAgent === "string" ? j.userAgent : "Mozilla/5.0",
      cookies: typeof j.cookies === "string" ? j.cookies : "",
    };
  } catch (err: any) {
    console.error("❌ Sign proxy error:", err?.message);
    return null;
  }
}

// ============================================================================
// WS ADAPTER — TikTok Custom Event Mapper
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
    const list = this.handlers[event];
    if (list) for (const fn of list) fn(data);
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url, { headers: this.headers });

      this.ws.on("open", () => {
        this.emit("connected", {});
        resolve();
      });

      this.ws.on("message", (buf: WebSocket.RawData) => {
        try {
          const s = buf.toString();
          const msg = JSON.parse(s);

          const payload = msg?.data || msg;
          const type = msg?.type || "";

          switch (type) {
            case "webcastGiftMessage":
              this.emit("gift", payload);
              break;
            case "webcastChatMessage":
              this.emit("chat", payload);
              break;
            case "webcastMemberMessage":
              this.emit("member", payload);
              break;
            case "webcastRoomMessage":
              this.emit("roomMessage", payload);
              break;
            default:
              break;
          }

          upsertIdentityFromLooseEvent(payload);
        } catch {
          // ignore wrong formats
        }
      });

      // --- FIX 3: type voor (e) toevoegen -------------------
      this.ws.on("error", (e: Error) => {
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
    if (hostSaved) return;
    if (!id) return;

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

  // CALL SIGN PROXY
  const sign = await getSignedUrl(cleanHost);

  if (!sign) {
    console.log("❌ Geen signedUrl via proxy → host lijkt offline");
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

        // signing-proxy geeft *nog* geen hostId → placeholder
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
