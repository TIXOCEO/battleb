// ============================================================================
// twistMessage.js — Simple Broadcast Twist Messaging v1.5 (USERNAME FIX + DIAMOND GUN LOGIC)
// ============================================================================

let box = null;

export function initTwistMessage() {
  box = document.getElementById("twist-message");
  if (!box) {
    console.warn("[TwistMessage] message box missing");
    return;
  }

  // Listen for forwarded messages from arena.js
  document.addEventListener("twist:message", (e) => {
    showMessage(e.detail);
  });
}

// Internal show helper
function show(msg) {
  if (!box) return;
  box.textContent = msg;
  box.classList.add("show");

  setTimeout(() => {
    box.classList.remove("show");
  }, 2500);
}

// ============================================================================
// NAME RESOLVERS — ALWAYS return a clean display name
// ============================================================================

function resolveSender(p) {
  return (
    p.byDisplayName ||
    p.byUsername ||
    p.by ||
    p.senderName ||
    "@onbekend"
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
// MAIN DISPATCH
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
    // MONEYGUN
    // ------------------------------------------------------------------------
    case "moneygun":
      if (target)
        return show(`${sender} markeert ${tStr} voor eliminatie aan het einde van de ronde!`);
      return show(`${sender} gebruikt MoneyGun!`);

    // ------------------------------------------------------------------------
    // IMMUNE
    // ------------------------------------------------------------------------
    case "immune":
      return show(`${sender} geeft immuniteit aan ${tStr}!`);

    // ------------------------------------------------------------------------
    // HEAL
    // ------------------------------------------------------------------------
    case "heal":
      return show(`${sender} herstelt ${tStr}!`);

    // ------------------------------------------------------------------------
    // BOMB
    // ------------------------------------------------------------------------
    case "bomb":
      if (victims)
        return show(`${sender} gooit een BOM → slachtoffer: ${vStr}!`);
      return show(`${sender} gooit een BOM!`);

    // ------------------------------------------------------------------------
    // GALAXY
    // ------------------------------------------------------------------------
    case "galaxy":
      return show(`${sender} draait de ranking om!`);

    // ------------------------------------------------------------------------
    // BREAKER
    // ------------------------------------------------------------------------
    case "breaker":
      return show(`${sender} breekt de immuniteit van ${tStr}!`);

    // ------------------------------------------------------------------------
    // DIAMOND PISTOL
    // ------------------------------------------------------------------------
    case "diamond":
    case "diamondpistol":
      if (survivor) {
        // Diamond pistol full logic:
        // 1 player survives, all others marked → beautiful message
        return show(`${sender} gebruikt Diamond Gun! ${sStr} overleeft — ALLE anderen gemarkeerd!`);
      }
      return show(`${sender} gebruikt Diamond Gun op ${tStr}!`);

    // ------------------------------------------------------------------------
    // DEFAULT
    // ------------------------------------------------------------------------
    default:
      return show(`${sender} gebruikt een twist!`);
  }
}

// Export to window for debugging
window.twistMessage = { show: showMessage };
