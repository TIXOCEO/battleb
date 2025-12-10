// ============================================================================
// twistMessage.js — Broadcast Twist Messaging v4.2 (HUD Popup Version)
// FULL PAYLOAD COMPAT — accepts ALL backend formats
// Target: #bb-twist-hud + #bb-twist-text
// With Color Variants (twist-moneygun, twist-bomb, etc.)
// ============================================================================

let box = null;
let textEl = null;

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
// INIT — delayed until DOM is fully ready
// ============================================================================
export function initTwistMessage() {
  box = document.getElementById("bb-twist-hud");
  textEl = document.getElementById("bb-twist-text");

  if (!box) {
    console.warn("[TwistMessage] ❌ #bb-twist-hud not found.");
    return;
  }
  if (!textEl) {
    console.warn("[TwistMessage] ❌ #bb-twist-text not found.");
    return;
  }

  console.log(
    "%c[TwistMessage] Ready (HUD popup mode)",
    "color:#00ffaa"
  );

  document.addEventListener("twist:message", (e) => {
    console.log(
      "%c[TwistMessage] Event received:",
      "color:#0ff",
      e.detail
    );

    const payload = normalizePayload(e.detail);
    showMessage(payload);
  });
}

// FIX: run ONLY after DOM is loaded
window.addEventListener("DOMContentLoaded", () => {
  initTwistMessage();
});

// ============================================================================
// INTERNAL SHOW FUNCTION — uses HUD popup + color variants
// ============================================================================
function show(msg, type = null) {
  if (!box || !textEl) return;

  textEl.textContent = msg;

  // Remove old color classes
  TWIST_COLOR_CLASSES.forEach((cls) => box.classList.remove(cls));

  // Add correct color class
  if (type) {
    const cls = "twist-" + type.toLowerCase();
    box.classList.add(cls);
  }

  box.classList.add("show");

  clearTimeout(window.__bb_twist_timer);
  window.__bb_twist_timer = setTimeout(() => {
    box.classList.remove("show");
  }, 2400);
}

// ============================================================================
// UNIVERSAL PAYLOAD NORMALIZER
// ============================================================================
function normalizePayload(p) {
  if (!p) return { type: "unknown" };

  return {
    type: p.type,

    byDisplayName:
      p.byDisplayName ||
      p.senderName ||
      p.displayName ||
      p.by ||
      "Onbekend",

    target:
      p.targetDisplayName ||
      p.targetUsername ||
      p.target ||
      null,

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
// MAIN MESSAGE BUILDER (backend-proof + color-aware)
// ============================================================================
export function showMessage(p) {
  if (!p || !p.type) {
    console.warn("[TwistMessage] Empty payload:", p);
    return;
  }

  const sender = p.byDisplayName;
  const target = p.target ? `@${p.target}` : null;
  const victims = Array.isArray(p.victims) && p.victims.length
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
        ? show(`${sender} markeert ${target} voor ELIMINATIE!`, t)
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
      return victims
        ? show(`${sender} gooit een BOM! Slachtoffer: ${victims}!`, t)
        : show(`${sender} laat een BOM ontploffen!`, t);

    case "galaxy":
      return show(`${sender} draait de HELE ranking om! Chaos!`, t);

    case "breaker":
      return target
        ? show(`${sender} BREKT de immuniteit van ${target}!`, t)
        : show(`${sender} gebruikt een Immunity Breaker!`, t);

    case "diamondpistol":
    case "diamond":
      return survivor
        ? show(
            `${sender} vuurt de DIAMOND GUN! ${survivor} overleeft — de rest ligt eruit!`,
            "diamondpistol"
          )
        : show(`${sender} gebruikt de Diamond Gun!`, "diamondpistol");

    default:
      return show(`${sender} activeert een twist.`, t);
  }
}

// Debug helper
window.twistMessage = { show: showMessage };
