// ============================================================================
// twistMessage.js — Broadcast Twist Messaging v4.0
// FULL PAYLOAD COMPAT — accepts ALL backend formats
// ============================================================================

let box = null;
let textEl = null;

export function initTwistMessage() {
  box = document.getElementById("twist-message");
  textEl = document.getElementById("twist-text");

  if (!box) {
    console.warn("[TwistMessage] ❌ #twist-message not found.");
    return;
  }
  if (!textEl) {
    console.warn("[TwistMessage] ❌ #twist-text not found.");
    return;
  }

  console.log("%c[TwistMessage] Ready (fullscreen popup mode)", "color:#00ffaa");

  document.addEventListener("twist:message", (e) => {
    console.log("%c[TwistMessage] Event received:", "color:#0ff", e.detail);
    showMessage(normalizePayload(e.detail));
  });
}


// ============================================================================
// INTERNAL SHOW FUNCTION
// ============================================================================

function show(msg) {
  if (!box || !textEl) return;

  textEl.textContent = msg;
  box.classList.add("show");

  setTimeout(() => box.classList.remove("show"), 2600);
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
// MAIN MESSAGE BUILDER (now backend-proof)
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

  console.log("%c[TwistMessage] Parsed:", "color:#ff0", { sender, target, victims, survivor });

  switch (p.type) {

    case "moneygun":
      return target
        ? show(`${sender} markeert ${target} voor ELIMINATIE!`)
        : show(`${sender} gebruikt MoneyGun!`);

    case "immune":
      return target
        ? show(`${sender} geeft ${target} IMMUNITEIT!`)
        : show(`${sender} deelt immuniteit uit!`);

    case "heal":
      return target
        ? show(`${sender} herstelt ${target}!`)
        : show(`${sender} voert een HEAL uit!`);

    case "bomb":
      return victims
        ? show(`${sender} gooit een BOM! Slachtoffer: ${victims}!`)
        : show(`${sender} laat een BOM ontploffen!`);

    case "galaxy":
      return show(`${sender} draait de HELE ranking om! Chaos!`);

    case "breaker":
      return target
        ? show(`${sender} BREKT de immuniteit van ${target}!`)
        : show(`${sender} gebruikt een Immunity Breaker!`);

    case "diamondpistol":
    case "diamond":
      return survivor
        ? show(`${sender} vuurt de DIAMOND GUN! ${survivor} overleeft — de rest ligt eruit!`)
        : show(`${sender} gebruikt de Diamond Gun!`);

    default:
      return show(`${sender} activeert een twist.`);
  }
}


// Debug helper
window.twistMessage = { show: showMessage };
