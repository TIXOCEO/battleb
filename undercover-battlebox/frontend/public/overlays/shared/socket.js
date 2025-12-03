// ============================================================================
// socket.js — BattleBox Overlay Socket Client v1.0 (Pure JS)
// Connects static OBS HTML overlays → backend Socket.IO server
// Fully browser-compatible, no TypeScript, no bundler required
// ============================================================================

let socketInstance = null;

// ----------------------------------------------------------------------------
// CONFIG (update if your server IP/domain ever changes)
// ----------------------------------------------------------------------------

const SOCKET_URL = "http://178.251.232.12:4000";   // backend websocket server
const FRONTEND_URL = "http://178.251.232.12:3000"; // overlay host domain

// Script-loader guard (only load Socket.IO client once)
let socketIoLoaded = false;

// ----------------------------------------------------------------------------
// Load the socket.io-client library dynamically (for static HTML overlays)
// ----------------------------------------------------------------------------

function loadSocketIoClient() {
  return new Promise((resolve, reject) => {
    if (socketIoLoaded) return resolve();

    const script = document.createElement("script");
    script.src = `${SOCKET_URL}/socket.io/socket.io.js`; // absolute load
    script.onload = () => {
      socketIoLoaded = true;
      resolve();
    };
    script.onerror = reject;

    document.head.appendChild(script);
  });
}

// ----------------------------------------------------------------------------
// INIT FUNCTION — returns a SINGLE live socket instance
// ----------------------------------------------------------------------------

export function getSocket() {
  return new Promise(async (resolve) => {
    // If already initialized
    if (socketInstance) {
      return resolve(socketInstance);
    }

    // Load Socket.IO client first
    await loadSocketIoClient();

    // Create socket
    socketInstance = window.io(SOCKET_URL, {
      transports: ["websocket"],
      path: "/socket.io",

      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,

      withCredentials: false,
      secure: false,

      extraHeaders: {
        "x-overlay-origin": FRONTEND_URL,
      }
    });

    // Debug status logs
    socketInstance.on("connect", () => {
      console.log(
        "%c[BattleBox Socket] Connected",
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
        "%c[BattleBox Socket] Error:",
        "color:#ff4d4f;font-weight:bold;",
        err.message
      );
    });

    resolve(socketInstance);
  });
}
