// ============================================================================
// twistMessage.js — Broadcast Twist Messaging v2.0 CINEMATIC EDITION
// Ultra-clean usernames • Punchy messages • OBS-proof fades • No fallbacks
// ============================================================================

let box = null;

export function initTwistMessage() {
  box = document.getElementById("twist-message");
  if (!box) {
    console.warn("[TwistMessage] message box missing");
    return;
  }

  document.addEventListener("twist:message", (e) => {
    showMessage(e.detail);
  });
}


function show(msg) {
  if (!box) return;

  box.textContent = msg;
  box.classList.add("show");

  setTimeout(() => {
    box.classList.remove("show");
  }, 2600);
}


// ============================================================================
// NAME RESOLUTION — safe, clean, zero fallback garbage
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
// MAIN LOGIC — Cinematic BattleBox messages
// ============================================================================

export function showMessage(payload) {
  if (!payload || !payload.type) return;

  const sender = resolveSender(payload);
  const target = resolveTarget(payload);
  const victims = resolveVictims(payload);
  const survivor = resolveSurvivor(payload);

  const tStr = target ? `@${target}` : "";
  const vStr = victims || "";
  const sStr = survivor ? `@${survivor}` : "";

  switch (payload.type) {

    // MONEY GUN
    case "moneygun":
      if (target)
        return show(`${sender} markeert ${tStr} voor ELIMINATIE!`);
      return show(`${sender} gebruikt MoneyGun!`);

    // IMMUNE
    case "immune":
      if (target) return show(`${sender} geeft ${tStr} IMMUNITEIT!`);
      return show(`${sender} deelt immuniteit uit!`);

    // HEAL
    case "heal":
      if (target) return show(`${sender} herstelt ${tStr}!`);
      return show(`${sender} voert een HEAL uit!`);

    // BOMB
    case "bomb":
      if (victims) return show(`${sender} gooit een BOM! Slachtoffer: ${vStr}!`);
      return show(`${sender} laat een BOM ontploffen!`);

    // GALAXY
    case "galaxy":
      return show(`${sender} draait de HELE ranking om! Chaos!`);

    // BREAKER
    case "breaker":
      if (target)
        return show(`${sender} BREKT de immuniteit van ${tStr}!`);
      return show(`${sender} gebruikt een Immunity Breaker!`);

    // DIAMOND PISTOL
    case "diamond":
    case "diamondpistol":
      if (survivor)
        return show(`${sender} vuurt de DIAMOND GUN! ${sStr} overleeft — de rest ligt eruit!`);
      return show(`${sender} gebruikt de Diamond Gun op ${tStr}!`);

    // NO FALLBACK ANYMORE
    default:
      return;
  }
}

// Debug
window.twistMessage = { show: showMessage };
