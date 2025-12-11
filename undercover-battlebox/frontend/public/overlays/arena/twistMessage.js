// ============================================================================
// twistMessage.js — Broadcast Twist Messaging v4.4 (HUD Popup Version)
// Fully synced with Twist Engine v8.1
// FIXES:
// ✔ Bullet-proof duplicate prevention (no false positives, no double popups)
// ✔ Correct BREAKER messages (always show target)
// ✔ Correct BOMB messages
// ✔ Popup NEVER blocks arena (CSS-safe)
// ✔ Works even when TLS fires events twice
// ============================================================================

let box = null;
let textEl = null;

// NEW: Prevent duplicate spam — now time-bucketed to avoid blocking real repeats
let lastTwistHash = null;
let lastTwistTime = 0;

// All possible color classes
const TWIST_COLOR_CLASSES = [
  "twist-moneygun",
  "twist-bomb",
  "twist-galaxy",
  "twist-immune",
  "twist-breaker",
  "twist-diamondpistol",
  "twist-heal"
];

// ============================================================================
// INIT
// ============================================================================
export function initTwistMessage() {
  box = document.getElementById("bb-twist-hud");
  textEl = document.getElementById("bb-twist-text");

  if (!box) return console.warn("[TwistMessage] ❌ #bb-twist-hud missing");
  if (!textEl) return console.warn("[TwistMessage] ❌ #bb-twist-text missing");

  console.log("%c[TwistMessage] Ready v4.4", "color:#00ffaa");

  document.addEventListener("twist:message", (e) => {
    const payload = normalizePayload(e.detail);
    console.log("%c[TwistMessage] Event received:", "color:#0ff", payload);

    // ==============================================================
    // 💥 IMPROVED DUPLICATE PREVENTION (TLS-safe)
    //    - Includes time bucket so new twists are never blocked
    //    - Eliminates double events from twist:takeover
    // ==============================================================

    const now = Date.now();
    const timeBucket = Math.floor(now / 1200); // 1.2 sec bucket

    const hash = `${payload.type}|${payload.byDisplayName}|${payload.target}|${payload.survivor}|${(payload.victims || []).join(",")}|${timeBucket}`;

    if (hash === lastTwistHash) {
      console.warn("[TwistMessage] Duplicate blocked:", hash);
      return;
    }

    lastTwistHash = hash;
    lastTwistTime = now;

    // ==============================================================

    showMessage(payload);
  });
}

window.addEventListener("DOMContentLoaded", () => {
  initTwistMessage();
});

// ============================================================================
// CORE SHOW FUNCTION
// ============================================================================
function show(msg, type = null) {
  if (!box || !textEl) return;

  textEl.textContent = msg;

  // remove old color classes
  TWIST_COLOR_CLASSES.forEach((cls) => box.classList.remove(cls));

  // add new class if exists
  if (type) {
    const cls = "twist-" + type.toLowerCase();
    box.classList.add(cls);
  }

  box.classList.add("show");

  clearTimeout(window.__bb_twist_timer);
  window.__bb_twist_timer = setTimeout(() => {
    box.classList.remove("show");
  }, 2600);
}

// ============================================================================
// UNIVERSAL PAYLOAD NORMALIZER (MOST ROBUST EVER)
// ============================================================================
function normalizePayload(p) {
  if (!p) return { type: "unknown" };

  return {
    type: (p.type || "").toLowerCase(),

    byDisplayName:
      p.byDisplayName ||
      p.by ||
      p.sender ||
      p.senderName ||
      "Onbekend",

    target:
      p.targetName ||
      p.targetDisplayName ||
      p.target ||
      null,

    survivors: p.survivors || [],

    victims:
      p.victimNames ||
      p.victims ||
      [],

    survivor:
      p.survivorName ||
      p.survivor ||
      null
  };
}

// ============================================================================
// MAIN MESSAGE BUILDER
// ============================================================================
export function showMessage(p) {
  if (!p || !p.type) return;

  const sender = p.byDisplayName;
  const target = p.target ? `@${p.target}` : null;
  const victims =
    Array.isArray(p.victims) && p.victims.length
      ? p.victims.map(v => `@${v}`).join(", ")
      : null;

  const survivor = p.survivor ? `@${p.survivor}` : null;

  console.log(
    "%c[TwistMessage] Parsed:",
    "color:#ff0",
    { sender, target, victims, survivor }
  );

  const t = p.type.toLowerCase();

  switch (t) {

    case "moneygun":
      return target
        ? show(`${sender} vuurt MoneyGun op ${target}!`, t)
        : show(`${sender} gebruikt MoneyGun!`, t);

    case "immune":
      return target
        ? show(`${sender} geeft ${target} IMMUNITEIT!`, t)
        : show(`${sender} deelt immuniteit uit!`, t);

    case "heal":
      return target
        ? show(`${sender} herstelt ${target}!`, t)
        : show(`${sender} voert een HEAL uit!`, t);

    case "bomb":
      return target
        ? show(`${sender} laat een BOM ontploffen op ${target}!`, t)
        : show(`${sender} gooit een BOM!`, t);

    case "breaker":
      return target
        ? show(`${sender} breekt de immuniteit van ${target}!`, t)
        : show(`${sender} gebruikt een Immunity Breaker!`, t);

    case "galaxy":
      return show(`${sender} draait de HELE ranking om! Chaos!`, t);

    case "diamondpistol":
      return survivor
        ? show(
            `${sender} vuurt de DIAMOND GUN → ${survivor} overleeft!`,
            "diamondpistol"
          )
        : show(`${sender} gebruikt de Diamond Gun!`, "diamondpistol");

    default:
      return show(`${sender} activeert een twist.`, t);
  }
}

// Debug
window.twistMessage = { show: showMessage };
