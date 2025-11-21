// ============================================================================
// 1-connection-euler.ts — v1.0 ULTRA EULER ENGINE
// Undercover BattleBox — TikTok LIVE via EulerStream
// No sign server. No TikTok requests. 100% WebSocket.
// ============================================================================

import WebSocket from "ws";
import dotenv from "dotenv";
dotenv.config();

import { emitLog, setLiveState, markTikTokEvent } from "../server";

// Engines
import { processEulerEvent } from "./euler-router";

// Host Lock
import { getSetting } from "../db";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let ws: WebSocket | null = null;
let reconnecting = false;
let healthInterval: NodeJS.Timeout | null = null;

// ============================================================================
// GET API KEY
// ============================================================================
const EULER_KEY = process.env.EULER_API_KEY || "";

// ============================================================================
// STATE
// ============================================================================
let currentHost = "";
let reconnectAttempts = 0;
let manualClose = false;

// ============================================================================
// START HEALTH MONITOR
// ============================================================================
function startHealthMonitor() {
  if (healthInterval) return;

  healthInterval = setInterval(async () => {
    const diff = Date.now() - (global as any).LAST_TIKTOK_EVENT;

    if (diff > 20000) {
      console.log("🛑 HEALTH: geen Euler events >20s → reconnect");
      await reconnectEuler(true);
    }
  }, 10000);
}

// ============================================================================
// CONNECT
// ============================================================================
export async function startEulerConnection(): Promise<void> {
  manualClose = false;

  const hostUsername =
    (await getSetting("host_username"))?.trim().replace("@", "") ?? "";

  currentHost = hostUsername.toLowerCase();

  if (!currentHost) {
    console.log("❌ Geen host ingesteld → Euler connectie stopt");
    return;
  }

  if (!EULER_KEY) {
    console.log("❌ Geen EULER_API_KEY ingesteld in .env");
    return;
  }

  const url =
    `wss://webcast.eulerstream.com/webcast?username=${currentHost}` +
    `&apikey=${EULER_KEY}` +
    `&device_id=${Math.floor(Math.random() * 99999999)}`;

  console.log("🔌 Verbinden met EulerStream…");
  console.log("→ Host:", currentHost);

  ws = new WebSocket(url, {
    handshakeTimeout: 15000,
    maxPayload: 10 * 1024 * 1024,
  });

  // ------------------------------------------------------------------------
  // OPEN
  // ------------------------------------------------------------------------
  ws.on("open", () => {
    console.log("✔ EulerStream WebSocket geopend");
    setLiveState(true);
    reconnectAttempts = 0;
    markTikTokEvent();
    startHealthMonitor();

    emitLog({
      type: "system",
      message: `EulerStream verbonden met @${currentHost}`,
    });
  });

  // ------------------------------------------------------------------------
  // MESSAGE
  // ------------------------------------------------------------------------
  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      markTikTokEvent();

      // Router verwerken
      processEulerEvent(data);
    } catch (err) {
      console.error("⚠ Onleesbaar Euler event:", err);
    }
  });

  // ------------------------------------------------------------------------
  // CLOSE
  // ------------------------------------------------------------------------
  ws.on("close", async () => {
    console.log("🔌 EulerStream WebSocket gesloten");
    setLiveState(false);

    if (!manualClose) {
      await reconnectEuler(false);
    }
  });

  // ------------------------------------------------------------------------
  // ERROR
  // ------------------------------------------------------------------------
  ws.on("error", async (err) => {
    console.error("❌ EulerStream fout:", err);

    if (!manualClose) {
      await reconnectEuler(false);
    }
  });
}

// ============================================================================
// RECONNECT
// ============================================================================
export async function reconnectEuler(force: boolean) {
  if (reconnecting) return;
  reconnecting = true;

  try {
    reconnectAttempts++;

    if (ws) {
      try {
        ws.close();
      } catch {}
    }

    const delay = force ? 1000 : Math.min(15000, reconnectAttempts * 3000);

    console.log(`🔄 Euler reconnect in ${delay}ms…`);
    await wait(delay);

    await startEulerConnection();
  } catch (err) {
    console.error("❌ Fout tijdens reconnect:", err);
  }

  reconnecting = false;
}

// ============================================================================
// STOP
// ============================================================================
export async function stopEulerConnection() {
  manualClose = true;
  try {
    if (ws) ws.close();
  } catch {}
  ws = null;
  setLiveState(false);
}

// ============================================================================
// END
// ============================================================================
