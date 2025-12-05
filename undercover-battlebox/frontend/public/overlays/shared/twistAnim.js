// ============================================================================
// twistAnim.js — BattleBox Arena Twist Animation Engine v7.0 FINAL
// ============================================================================
//
// Upgrades v7.0:
// ------------------------------------------------------------
// ✔ Ondersteuning voor nieuwe payload (target/victims/survivor)
// ✔ BOMB countdown 3 → 2 → 1 animatie
// ✔ Nieuwe functie: playCountdown(root, step)
// ✔ Nieuwe functies voor target/victim/survivor highlight
// ✔ Volledig backward compatible met v1.5 gedrag
// ✔ TwistQueue ready
//
// ============================================================================

/**
 * Speelt een volledige twist animatie.
 * @param {HTMLElement} root 
 * @param {string} type 
 * @param {string} title 
 * @param {object} payload - volledige twist payload (optioneel)
 */
export function playTwistAnimation(root, type, title = "", payload = {}) {
  if (!root) return;

  root.classList.remove("show");
  root.innerHTML = "";

  const html = buildTwistHTML(type, title, payload);
  root.innerHTML = html;

  queueMicrotask(() => {
    void root.offsetWidth;
    root.classList.add("show");
  });
}

/**
 * Cleart twist animatie.
 */
export function clearTwistAnimation(root) {
  if (!root) return;

  root.classList.remove("show");

  setTimeout(() => {
    root.innerHTML = "";
  }, 80);
}

// ============================================================================
// COUNTDOWN ANIMATIE (3 → 2 → 1)
// ============================================================================
export function playCountdown(root, step = 3) {
  if (!root) return;

  root.classList.remove("show");
  root.innerHTML = "";

  const html = renderCountdownHTML(step);
  root.innerHTML = html;

  queueMicrotask(() => {
    void root.offsetWidth;
    root.classList.add("show");
  });
}

function renderCountdownHTML(step) {
  return `
    <div class="twist-anim bomb-countdown">
      <div class="count-number step-${step}">
        ${step}
      </div>
    </div>
  `;
}

// ============================================================================
// TARGET / VICTIM / SURVIVOR ANIMATIONS (gebruikt in arena.js)
// ============================================================================

export function playTargetAnimation(root, payload) {
  if (!root || !payload?.targetName) return;

  root.classList.remove("show");
  root.innerHTML = `
    <div class="twist-anim target-hit">
      <div class="twist-title">${payload.targetName}</div>
    </div>
  `;

  queueMicrotask(() => {
    void root.offsetWidth;
    root.classList.add("show");
  });
}

export function playVictimAnimations(root, payload) {
  if (!root || !payload?.victimNames?.length) return;

  const html = payload.victimNames
    .map(
      (v) => `
        <div class="twist-anim victim-blast">
          <div class="victim-name">${v}</div>
        </div>
      `
    )
    .join("");

  root.classList.remove("show");
  root.innerHTML = html;

  queueMicrotask(() => {
    void root.offsetWidth;
    root.classList.add("show");
  });
}

export function playSurvivorAnimation(root, payload) {
  if (!root || !payload?.survivorName) return;

  root.classList.remove("show");
  root.innerHTML = `
    <div class="twist-anim survivor-shield">
      <div class="survivor-name">${payload.survivorName}</div>
    </div>
  `;

  queueMicrotask(() => {
    void root.offsetWidth;
    root.classList.add("show");
  });
}

// ============================================================================
// HTML BUILDERS — originele animaties blijven bestaan
// ============================================================================

function buildTwistHTML(type, title, payload = {}) {
  switch (type) {
    case "diamond":
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

/* ============================================================================
   DIAMOND PISTOL — exploding diamond shards
============================================================================ */
function diamondPistolHTML(title) {
  const shards = [...Array(36)]
    .map(() => `<div class="diamond-shard"></div>`)
    .join("");

  return `
    <div class="twist-anim diamond-blast">
      <div class="twist-title">${title}</div>
      ${shards}
    </div>
  `;
}

/* ============================================================================
   MONEY GUN
============================================================================ */
function moneyGunHTML(title) {
  const bills = [...Array(32)]
    .map(() => `<div class="money-bill"></div>`)
    .join("");

  return `
    <div class="twist-anim money-spray">
      <div class="twist-title">${title}</div>
      ${bills}
    </div>
  `;
}

/* ============================================================================
   BOMB SHOCKWAVE
============================================================================ */
function bombHTML(title) {
  return `
    <div class="twist-anim bomb-blast">
      <div class="twist-title">${title}</div>
      <div class="bomb-core"></div>
      <div class="bomb-wave"></div>
    </div>
  `;
}

/* ============================================================================
   IMMUNE — green aura
============================================================================ */
function immuneHTML(title) {
  return `
    <div class="twist-anim immune-aura">
      <div class="twist-title">${title}</div>
      <div class="aura-ring"></div>
    </div>
  `;
}

/* ============================================================================
   HEAL
============================================================================ */
function healHTML(title) {
  return `
    <div class="twist-anim heal-cross">
      <div class="twist-title">${title}</div>
      <div class="heal-plus"></div>
    </div>
  `;
}

/* ============================================================================
   GALAXY
============================================================================ */
function galaxyHTML(title) {
  return `
    <div class="twist-anim galaxy-vortex">
      <div class="twist-title">${title}</div>

      <div class="galaxy-stars"></div>

      <div class="galaxy-ring"></div>
      <div class="galaxy-ring2"></div>
      <div class="galaxy-flare"></div>
    </div>
  `;
}

/* ============================================================================
   GENERIC FALLBACK
============================================================================ */
function genericHTML(title) {
  return `
    <div class="twist-anim">
      <div class="twist-title">${title}</div>
    </div>
  `;
}
