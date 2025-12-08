// ============================================================================
// twistMessage.js — Broadcast Twist Messaging v1.8 FINAL
// Punchy messages • Clean usernames • Viewer-friendly terminology
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

  setTimeout(() => box.classList.remove("show"), 2600);
}

// ============================================================================
// NAME RESOLUTION — clean & safe
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
// MAIN LOGIC — Improved BattleBox Broadcast Phrases
// ============================================================================

export function showMessage(payload) {
  if (!payload || !payload.type) return;

  const sender = resolveSender(payload);
  const target = resolveTarget(payload);
  const victims = resolveVictims(payload);
  const survivor = resolveSurvivor(payload);

  const tStr = target ? `@${target}` : "";
  const vStr = victims ? victims : "";
  const sStr = survivor ? `@${survivor}` : "";

  switch (payload.type) {

    // ------------------------------------------------------------------------
    // MONEYGUN — elimination marker
    // ------------------------------------------------------------------------
    case "moneygun":
      if (target)
        return show(`${sender} markeert ${tStr} voor ELIMINATIE aan het einde van de ronde!`);
      return show(`${sender} gebruikt MoneyGun!`);

    // ------------------------------------------------------------------------
    // IMMUNE — shield
    // ------------------------------------------------------------------------
    case "immune":
      if (target)
        return show(`${sender} geeft ${tStr} IMMUNITEIT!`);
      return show(`${sender} deelt een immuniteit uit!`);

    // ------------------------------------------------------------------------
    // HEAL — removes elimination mark
    // ------------------------------------------------------------------------
    case "heal":
      if (target)
        return show(`${sender} herstelt ${tStr}!`);
      return show(`${sender} voert een HEAL uit!`);

    // ------------------------------------------------------------------------
    // BOMB — random victim(s)
    // ------------------------------------------------------------------------
    case "bomb":
      if (victims)
        return show(`${sender} gooit een BOM! Slachtoffer: ${vStr}!`);
      return show(`${sender} laat een BOM ontploffen!`);

    // ------------------------------------------------------------------------
    // GALAXY — ranking flip
    // ------------------------------------------------------------------------
    case "galaxy":
      return show(`${sender} draait de HELE ranking om! Chaos!`);

    // ------------------------------------------------------------------------
    // BREAKER — breaks immunity
    // ------------------------------------------------------------------------
    case "breaker":
      if (target)
        return show(`${sender} BREKT de immuniteit van ${tStr}!`);
      return show(`${sender} gebruikt een Immunity Breaker!`);

    // ------------------------------------------------------------------------
    // DIAMOND PISTOL — single survivor
    // ------------------------------------------------------------------------
    case "diamond":
    case "diamondpistol":
      if (survivor) {
        return show(`${sender} vuurt de DIAMOND GUN! ${sStr} overleeft — de rest ligt eruit!`);
      }
      return show(`${sender} gebruikt de Diamond Gun op ${tStr}!`);

    // ------------------------------------------------------------------------
    // DEFAULT
    // ------------------------------------------------------------------------
    default:
      return show(`${sender} gebruikt een twist!`);
  }
}

window.twistMessage = { show: showMessage };
