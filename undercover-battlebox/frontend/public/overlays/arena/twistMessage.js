// ============================================================================
// twistMessage.js — Broadcast Twist Messaging v3.0
// Fullscreen Center Popup Edition (2025)
// ============================================================================
// ✔ Schrijft naar #twist-text in plaats van #twist-message zelf
// ✔ OBS-proof fades
// ✔ Perfect centraal in beeld
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
    showMessage(e.detail);
  });
}


// ============================================================================
// INTERNAL SHOW FUNCTION — writes to #twist-text
// ============================================================================

function show(msg) {
  if (!box || !textEl) return;

  textEl.textContent = msg;

  box.classList.add("show");

  setTimeout(() => {
    box.classList.remove("show");
  }, 2600);
}


// ============================================================================
// NAME RESOLUTION — safe, clean
// ============================================================================

function resolveSender(p) {
  return (
    p.byDisplayName ||
    p.byUsername ||
    p.by ||
    p.senderName ||
    "Onbekend"
  );
}

function resolveTarget(p) {
  return (
    p.targetDisplayName ||
    p.targetUsername ||
    p.targetName ||
    null
  );
}

function resolveVictims(p) {
  if (!Array.isArray(p.victimNames) || !p.victimNames.length) return null;
  return p.victimNames.map((v) => `@${v}`).join(", ");
}

function resolveSurvivor(p) {
  return (
    p.survivorName ||
    p.survivorDisplayName ||
    null
  );
}


// ============================================================================
// MAIN MESSAGE BUILDER
// ============================================================================

export function showMessage(payload) {
  if (!payload || !payload.type) {
    console.warn("[TwistMessage] Empty payload:", payload);
    return;
  }

  const sender = resolveSender(payload);
  const target = resolveTarget(payload);
  const victims = resolveVictims(payload);
  const survivor = resolveSurvivor(payload);

  const tStr = target ? `@${target}` : "";
  const vStr = victims || "";
  const sStr = survivor ? `@${survivor}` : "";

  console.log("%c[TwistMessage] Parsed:", "color:#ff0", {
    sender, target, victims, survivor
  });

  switch (payload.type) {

    case "moneygun":
      return target
        ? show(`${sender} markeert ${tStr} voor ELIMINATIE!`)
        : show(`${sender} gebruikt MoneyGun!`);

    case "immune":
      return target
        ? show(`${sender} geeft ${tStr} IMMUNITEIT!`)
        : show(`${sender} deelt immuniteit uit!`);

    case "heal":
      return target
        ? show(`${sender} herstelt ${tStr}!`)
        : show(`${sender} voert een HEAL uit!`);

    case "bomb":
      return victims
        ? show(`${sender} gooit een BOM! Slachtoffer: ${vStr}!`)
        : show(`${sender} laat een BOM ontploffen!`);

    case "galaxy":
      return show(`${sender} draait de HELE ranking om! Chaos!`);

    case "breaker":
      return target
        ? show(`${sender} BREKT de immuniteit van ${tStr}!`)
        : show(`${sender} gebruikt een Immunity Breaker!`);

    case "diamond":
    case "diamondpistol":
      return survivor
        ? show(`${sender} vuurt de DIAMOND GUN! ${sStr} overleeft — de rest ligt eruit!`)
        : show(`${sender} gebruikt de Diamond Gun op ${tStr}!`);

    default:
      console.warn("[TwistMessage] Unknown type:", payload.type);
      return;
  }
}


// Debug helper
window.twistMessage = { show: showMessage };
