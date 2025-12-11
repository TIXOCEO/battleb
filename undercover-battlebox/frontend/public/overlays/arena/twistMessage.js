// ============================================================================
// twistMessage.js — Broadcast Twist Messaging v4.5 (HUD Popup Version)
// Fully synced with Twist Engine v8.1
//
// NEW FIXES IN V4.5:
// ✔ Diamond Gun shows FULL correct text (target + elimination message)
// ✔ Duplicate prevention improved (Diamond Gun never blocked incorrectly)
// ✔ Galaxy popup safe, no overlay blocking
// ✔ Strongest normalizer so far (survivor/target always found)
// ============================================================================

let box = null;
let textEl = null;

// NEW: prevent duplicate spam (TLS-safe)
let lastTwistHash = null;

// All popup color classes
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

  console.log("%c[TwistMessage] Ready v4.5", "color:#00ffaa");

  document.addEventListener("twist:message", (e) => {
    const payload = normalizePayload(e.detail);
    console.log("%c[TwistMessage] Event received:", "color:#0ff", payload);

    // ==============================================================
    // TLS-SAFE DUPLICATE FILTER
    // - Time bucket prevents blocking real repeats
    // - Diamond Gun always allowed to pass (unique hash)
    // ==============================================================

    const now = Date.now();
    const bucket = Math.floor(now / 1200);

    const hash = `${payload.type}|${payload.byDisplayName}|${payload.target}|${payload.survivor}|${bucket}`;

    // Diamond Gun gets special hash → NEVER blocked
    const isDiamond = payload.type === "diamondpistol";
    
    if (!isDiamond && hash === lastTwistHash) {
      console.warn("[TwistMessage] Duplicate blocked:", hash);
      return;
    }

    lastTwistHash = hash;

    showMessage(payload);
  });
}

window.addEventListener("DOMContentLoaded", () => {
  initTwistMessage();
});

// ============================================================================
// SHOW
// ============================================================================
function show(msg, type = null) {
  if (!box || !textEl) return;

  textEl.textContent = msg;

  // remove old classes
  TWIST_COLOR_CLASSES.forEach((cls) => box.classList.remove(cls));

  if (type) {
    const cls = "twist-" + type.toLowerCase();
    box.classList.add(cls);
  }

  box.classList.add("show");

  clearTimeout(window.__bb_twist_timer);
  window.__bb_twist_timer = setTimeout(() => {
    box.classList.remove("show");
  }, 2700);
}

// ============================================================================
// NORMALIZER — safest version ever
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
// MAIN MESSAGE BUILDER — NOW WITH CORRECT DIAMOND GUN
// ============================================================================
export function showMessage(p) {
  if (!p || !p.type) return;

  const sender = p.byDisplayName;
  const target = p.target ? `@${p.target}` : null;
  const survivor = p.survivor ? `@${p.survivor}` : null;

  const t = p.type.toLowerCase();

  console.log(
    "%c[TwistMessage] Parsed:",
    "color:#ff0",
    { sender, target, survivor }
  );

  switch (t) {

    // =====================================================================
    // 💸 MONEY GUN
    // =====================================================================
    case "moneygun":
      return target
        ? show(`${sender} vuurt de MoneyGun af op ${target}!`, t)
        : show(`${sender} gebruikt een MoneyGun!`, t);

    // =====================================================================
    // 🛡 IMMUNE
    // =====================================================================
    case "immune":
      return target
        ? show(`${sender} geeft ${target} volledige IMMUNITEIT!`, t)
        : show(`${sender} deelt immuniteit uit!`, t);

    // =====================================================================
    // ➕ HEAL
    // =====================================================================
    case "heal":
      return target
        ? show(`${sender} herstelt ${target}!`, t)
        : show(`${sender} voert een HEAL uit!`, t);

    // =====================================================================
    // 💣 BOMB
    // =====================================================================
    case "bomb":
      return target
        ? show(`${sender} laat een BOM ontploffen op ${target}!`, t)
        : show(`${sender} gooit een BOM!`, t);

    // =====================================================================
    // 🔨 BREAKER
    // =====================================================================
    case "breaker":
      return target
        ? show(`${sender} breekt de immuniteit van ${target}!`, t)
        : show(`${sender} gebruikt een Immunity Breaker!`, t);

    // =====================================================================
    // 🪐 GALAXY
    // =====================================================================
    case "galaxy":
      return show(`${sender} activeert GALAXY — totale chaos!`, t);

    // =====================================================================
    // 💎 DIAMOND GUN — FULLY CUSTOM MESSAGE
    // =====================================================================
    case "diamondpistol":
      return buildDiamondGunMessage(sender, target, survivor);

    // =====================================================================
    // DEFAULT
    // =====================================================================
    default:
      return show(`${sender} activeert een twist.`, t);
  }
}

// ============================================================================
// 💎 DIAMOND GUN MESSAGE BUILDER
// ============================================================================
function buildDiamondGunMessage(sender, target, survivor) {
  if (survivor && target) {
    return show(
      `${sender} gebruikt de Diamond Gun op ${target}! ${survivor} overleeft — alle anderen worden UITGESCHAKELD!`,
      "diamondpistol"
    );
  }

  if (target) {
    return show(
      `${sender} vuurt de Diamond Gun → ${target} overleeft! Alle anderen vallen af!`,
      "diamondpistol"
    );
  }

  if (survivor) {
    return show(
      `${sender} gebruikt de Diamond Gun — ${survivor} overleeft! De rest is UITGESCHAKELD!`,
      "diamondpistol"
    );
  }

  return show(`${sender} gebruikt de Diamond Gun!`, "diamondpistol");
}

// expose
window.twistMessage = { show: showMessage };
