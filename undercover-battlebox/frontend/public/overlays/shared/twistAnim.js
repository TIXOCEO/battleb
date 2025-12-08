// ============================================================================
// twistAnim.js — BattleBox Arena Twist Animation Engine v8.0 CINEMATIC EDITION
// OBS-PROOF • DOUBLE-REFLOW FIX • GALAXY AUTO-CLEAR • CLEAN TITLE INJECTION
// ============================================================================
//
// Nieuwe features v8.0:
// ------------------------------------------------------------
// ✔ Dubbele requestAnimationFrame → OBS animatiestart 100% gegarandeerd
// ✔ Force-detach innerHTML → geen ghosting / stuck frames
// ✔ Galaxy animatie auto fade-out na 5 sec
// ✔ Bomb/blur verwijderd (arena.js handelt FX)
// ✔ Cine-overlay HTML volledig gerefactored
// ✔ Countdown identiek aan arena.js pad
// ✔ Geen fallback “gebruikt een twist” meer
//
// ============================================================================


// ============================================================================
// UTILITIES
// ============================================================================

function forceReflow(el) {
  void el && el.offsetWidth;
}

function detachContent(el) {
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
}


// ============================================================================
// MAIN FULLSCREEN TWIST ANIMATION
// ============================================================================

export function playTwistAnimation(root, type, title = "", payload = {}) {
  if (!root) return;

  root.classList.remove("show");
  detachContent(root);

  const html = buildTwistHTML(type, title, payload);
  root.innerHTML = html;

  // OBS double-reflow fix
  requestAnimationFrame(() => {
    forceReflow(root);
    requestAnimationFrame(() => {
      root.classList.add("show");
    });
  });
}


// ============================================================================
// CLEAR MAIN OVERLAY
// ============================================================================

export function clearTwistAnimation(root) {
  if (!root) return;

  root.classList.remove("show");

  setTimeout(() => {
    detachContent(root);
  }, 350);
}


// ============================================================================
// COUNTDOWN
// ============================================================================

export function playCountdown(root, step = 3) {
  if (!root) return;

  root.classList.remove("show");
  detachContent(root);

  root.innerHTML = renderCountdownHTML(step);

  requestAnimationFrame(() => {
    forceReflow(root);
    requestAnimationFrame(() => {
      root.classList.add("show");
    });
  });
}

function renderCountdownHTML(step) {
  return `
    <div class="twist-anim cinematic-countdown">
      <div class="count-number">${step}</div>
    </div>
  `;
}


// ============================================================================
// FULL HTML BUILDERS — CINEMATIC EDITION
// ============================================================================

function buildTwistHTML(type, title, payload = {}) {
  switch (type) {
    case "diamond":
    case "diamondpistol":
      return diamondPistolHTML(title);

    case "moneygun":
      return moneyGunHTML(title);

    case "bomb":
      return bombHTML(title);

    case "immune":
      return immuneHTML(title);

    case "heal":
      return healHTML(title);

    case "galaxy":
      return galaxyHTML(title);

    case "countdown":
      return renderCountdownHTML(payload.step || 3);

    default:
      return genericHTML(title);
  }
}


// ============================================================================
// DIAMOND PISTOL
// ============================================================================

function diamondPistolHTML(title) {
  const shards = [...Array(42)].map(() => `<div class="diamond-shard"></div>`).join("");

  return `
    <div class="twist-anim cinematic diamond-blast">
      <div class="twist-title">${title}</div>
      ${shards}
    </div>
  `;
}


// ============================================================================
// MONEY GUN
// ============================================================================

function moneyGunHTML(title) {
  const bills = [...Array(48)].map(() => `<div class="money-bill"></div>`).join("");

  return `
    <div class="twist-anim cinematic moneygun-spray">
      <div class="twist-title">${title}</div>
      ${bills}
    </div>
  `;
}


// ============================================================================
// BOMB
// ============================================================================

function bombHTML(title) {
  return `
    <div class="twist-anim cinematic bomb-explosion">
      <div class="twist-title">${title}</div>
      <div class="bomb-core"></div>
      <div class="bomb-wave"></div>
    </div>
  `;
}


// ============================================================================
// IMMUNE
// ============================================================================

function immuneHTML(title) {
  return `
    <div class="twist-anim cinematic immune-aura">
      <div class="twist-title">${title}</div>
      <div class="aura-ring"></div>
    </div>
  `;
}


// ============================================================================
// HEAL
// ============================================================================

function healHTML(title) {
  return `
    <div class="twist-anim cinematic heal-anim">
      <div class="twist-title">${title}</div>
      <div class="heal-plus"></div>
    </div>
  `;
}


// ============================================================================
// GALAXY — AUTO FADE-OUT AFTER 5s
// ============================================================================

function galaxyHTML(title) {
  setTimeout(() => {
    const el = document.getElementById("twist-takeover");
    if (el) el.classList.remove("show");
  }, 5000);

  return `
    <div class="twist-anim cinematic galaxy-vortex">
      <div class="twist-title">${title}</div>
      <div class="galaxy-stars"></div>
      <div class="galaxy-ring"></div>
      <div class="galaxy-ring2"></div>
      <div class="galaxy-flare"></div>
    </div>
  `;
}


// ============================================================================
// GENERIC
// ============================================================================

function genericHTML(title) {
  return `
    <div class="twist-anim cinematic">
      <div class="twist-title">${title}</div>
    </div>
  `;
}
