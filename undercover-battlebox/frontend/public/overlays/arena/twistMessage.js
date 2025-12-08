// ============================================================================
// twistMessage.js — Simple Broadcast Twist Messaging v1.0
// ============================================================================

let box = null;

export function initTwistMessage() {
  box = document.getElementById("twist-message");
  if (!box) {
    console.warn("[TwistMessage] message box missing");
    return;
  }

  // Listen to dispatch from arena.js
  document.addEventListener("twist:message", (e) => {
    showMessage(e.detail);
  });
}

function show(msg) {
  if (!box) return;
  box.textContent = msg;
  box.classList.add("show");
  setTimeout(() => box.classList.remove("show"), 2500);
}

export function showMessage(payload) {
  if (!payload || !payload.type) return;

  const user = payload.by || payload.senderName || "@user";
  const target = payload.targetName ? `@${payload.targetName}` : "";
  const victim = payload.victimNames?.length ? payload.victimNames.map(v => `@${v}`).join(", ") : "";

  switch (payload.type) {
    case "moneygun":
      return show(`${user} elimineert ${target} aan het einde van de ronde!`);
    case "immune":
      return show(`${user} geeft immuniteit aan ${target}!`);
    case "heal":
      return show(`${user} herstelt ${target}!`);
    case "bomb":
      return show(`${user} gooit een BOM!`);
    case "galaxy":
      return show(`${user} draait de ranking om!`);
    case "diamond":
    case "diamondpistol":
      return show(`${user} gebruikt Diamond Gun op ${target}!`);
    case "breaker":
      return show(`${user} breekt de immuniteit van ${target}!`);
    default:
      return show(`${user} gebruikt een twist!`);
  }
}

window.twistMessage = { show: showMessage };
