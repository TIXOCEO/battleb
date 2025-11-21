// ============================================================================
// euler-connection.ts — ULTRA ENGINE 2.0
// Military-Grade TikTok LIVE WebSocket Engine powered by Euler
// ============================================================================
import WebSocket from "ws";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface EulerConnection {
  ws: WebSocket;
  close: () => Promise<void>;
}

let lastPacketAt = Date.now();
let healthTimer: NodeJS.Timeout | null = null;
let reconnecting = false;

export function getLastPacketTime() {
  return lastPacketAt;
}

export async function startEuler(
  apiKey: string,
  hostUsername: string,
  onPacket: (packet: any) => void
): Promise<EulerConnection | null> {
  let attempt = 0;

  async function connect(): Promise<EulerConnection | null> {
    attempt++;

    console.log(
      `🔌 [EULER] Connecting to TikTok LIVE for @${hostUsername} (attempt ${attempt})`
    );

    const ws = new WebSocket(
      `wss://api.eulerstream.com/v1/live?username=${hostUsername}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    return new Promise((resolve) => {
      ws.on("open", () => {
        console.log("✔ [EULER] WebSocket open");
        lastPacketAt = Date.now();
        reconnecting = false;
        resolve({
          ws,
          close: async () => {
            try {
              ws.close();
            } catch {}
          },
        });
      });

      ws.on("message", (msg) => {
        try {
          lastPacketAt = Date.now();

          const packet = JSON.parse(msg.toString());
          onPacket(packet);
        } catch (err) {
          console.error("❌ [EULER] Packet parse error:", err);
        }
      });

      ws.on("close", async () => {
        console.log("⛔ [EULER] Connection closed");
        if (!reconnecting) attemptReconnect();
      });

      ws.on("error", (err) => {
        console.error("❌ [EULER] WebSocket error:", err);
      });

      // fail-safe timeout
      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          try {
            ws.terminate();
          } catch {}
        }
      }, 8000);
    });
  }

  async function attemptReconnect() {
    reconnecting = true;
    if (healthTimer) clearInterval(healthTimer);

    let backoff = Math.min(3000 * attempt, 30000); // 3s → 6 → 9 → 12 → max 30s

    console.log(`🔄 [EULER] Reconnecting in ${backoff / 1000}s...`);
    await wait(backoff);

    return startEuler(apiKey, hostUsername, onPacket);
  }

  // ----------------------------------------------------------
  // HEALTH WATCHDOG
  // ----------------------------------------------------------
  function startHealth() {
    if (healthTimer) clearInterval(healthTimer);

    healthTimer = setInterval(async () => {
      const diff = Date.now() - lastPacketAt;

      if (diff > 12000) {
        console.log("🛑 [EULER] No packets >12s — force reconnect");
        reconnecting = true;

        if (healthTimer) clearInterval(healthTimer);
        return startEuler(apiKey, hostUsername, onPacket);
      }
    }, 4000);
  }

  const conn = await connect();
  if (conn) startHealth();
  return conn;
}
