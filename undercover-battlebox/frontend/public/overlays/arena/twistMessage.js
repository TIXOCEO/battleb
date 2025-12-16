// ============================================================================
// twistMessage.js — Broadcast Twist Messaging v4.6 (HUD Popup Version)
// ============================================================================

let box = null;
let textEl = null;

// prevent duplicate spam (TLS-safe)
let lastTwistHash = null;

// NEW: bomb scan suppression (HUD-only, no gameplay impact)
let pendingBombHash = null;

// NEW: persist bomb sender between START → HIT
let lastBombSenderName = null;

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

  console.log("%c[TwistMessage] Ready v4.6", "color:#00ffaa");

  document.addEventListener("twist:message", (e) => {
    const payload = normalizePayload(e.detail);
    console.log("%c[TwistMessage] Event received:", "color:#0ff", payload);

    const now = Date.now();
    const bucket = Math.floor(now / 1200);

    const baseHash = `${payload.type}|${payload.byDisplayName}`;
    const hash =
      payload.type === "bomb"
        ? baseHash
        : `${baseHash}|${payload.target}|${payload.survivor}|${bucket}`;

    const isDiamond = payload.type === "diamondpistol";

// ----------------------------------------------------------------------
// 💣 BOMB SPECIAL CASE (START vs HIT)
// ----------------------------------------------------------------------
if (payload.type === "bomb") {
  if (pendingBombHash !== hash) {
    // FIRST = START → suppress + remember sender
    pendingBombHash = hash;
    lastBombSenderName = payload.byDisplayName || lastBombSenderName;
    console.log(
      "[TwistMessage] Bomb START suppressed, sender stored:",
      lastBombSenderName
    );
    return;
  }

  // SECOND = HIT → allow + restore sender
  pendingBombHash = null;
  if (lastBombSenderName) {
    payload.byDisplayName = lastBombSenderName;
  }
}

    // ----------------------------------------------------------------------
    // DUPLICATE FILTER
    // ----------------------------------------------------------------------
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

  TWIST_COLOR_CLASSES.forEach((cls) => box.classList.remove(cls));

  if (type) {
    box.classList.add("twist-" + type.toLowerCase());
  }

  box.classList.add("show");

  clearTimeout(window.__bb_twist_timer);
  window.__bb_twist_timer = setTimeout(() => {
    box.classList.remove("show");
  }, 2700);
}

// ============================================================================
// NORMALIZER
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
    victims: p.victimNames || p.victims || [],
    survivor: p.survivorName || p.survivor || null
  };
}

// ============================================================================
// MESSAGE BUILDER
// ============================================================================
export function showMessage(p) {
  if (!p || !p.type) return;

  const sender = p.byDisplayName;
  const target = p.target ? `@${p.target}` : null;
  const survivor = p.survivor ? `@${p.survivor}` : null;

  const t = p.type.toLowerCase();

  switch (t) {
    case "moneygun":
      return target
        ? show(`${sender} vuurt de MoneyGun af op ${target}!`, t)
        : show(`${sender} gebruikt een MoneyGun!`, t);

    case "immune":
      return target
        ? show(`${sender} geeft ${target} volledige IMMUNITEIT!`, t)
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
      return show(`${sender} activeert GALAXY — totale chaos!`, t);

    case "diamondpistol":
      return buildDiamondGunMessage(sender, target, survivor);

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
