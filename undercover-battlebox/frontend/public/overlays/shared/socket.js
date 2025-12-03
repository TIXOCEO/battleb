// ============================================================================
// socket.js — BattleBox Overlay Socket Client v1.2 (Pure JS)
// Stable. Async. OBS-safe.
// ✔ Overlay authenticatie toegevoegd (auth: { type: "overlay" })
// ✔ Niets anders gewijzigd
// ============================================================================

let socketInstance = null;

// Backend config
const SOCKET_URL = "http://178.251.232.12:4000";
const FRONTEND_URL = "http://178.251.232.12:3000";

let scriptLoaded = false;

// -------------------------------------------------------------
// Load socket.io script dynamically — required for static HTML
// -------------------------------------------------------------
function loadSocketIoClient() {
  return new Promise((resolve, reject) => {
    if (scriptLoaded) return resolve();

    const script = document.createElement("script");
    script.src = `${SOCKET_URL}/socket.io/socket.io.js`;
    script.onload = () => {
      scriptLoaded = true;
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// -------------------------------------------------------------
// getSocket() — always returns a READY socket
// -------------------------------------------------------------
export async function getSocket() {
  // return existing instance
  if (socketInstance) return socketInstance;

  // load client lib
  await loadSocketIoClient();

  // create socket — OVERLAY AUTH PATCH
  socketInstance = window.io(SOCKET_URL, {
    transports: ["websocket"],
    path: "/socket.io",
    auth: { type: "overlay" },      // 🔥 BELANGRIJK
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionAttempts: Infinity,
    withCredentials: false,
    secure: false,
    extraHeaders: {
      "x-overlay-origin": FRONTEND_URL
    }
  });

  // Debug
  socketInstance.on("connect", () => {
    console.log(
      "%c[BattleBox Socket] Connected (Overlay)",
      "color:#0fffd7;font-weight:bold;"
    );
  });

  socketInstance.on("disconnect", () => {
    console.log(
      "%c[BattleBox Socket] Disconnected",
      "color:#ff4d4f;font-weight:bold;"
    );
  });

  socketInstance.on("connect_error", (err) => {
    console.log(
      "%c[BattleBox Socket] ERROR",
      "color:#ff4d4f;font-weight:bold;",
      err.message
    );
  });

  return socketInstance;
}
