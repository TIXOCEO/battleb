// ============================================================================
// twistAnim.js — BattleBox Arena Twist Animation Engine v1.5 QUEUE-SAFE FINAL
// ============================================================================
//
// Upgrades v1.5:
// ------------------------------------------------------------
// ✔ Animaties starten ALTIJD opnieuw (forced reflow + reset)
// ✔ CSS animations kunnen niet meer "hangen"
// ✔ Safe clear() met no-break race protection
// ✔ Fully compatible met arena.js v6.3 TwistQueue engine
// ✔ Galaxy animatie correct zichtbaar en reset
//
// ============================================================================

export function playTwistAnimation(root, type, title = "") {
  if (!root) return;

  // 1) CLEAR old content
  root.classList.remove("show");
  root.innerHTML = "";

  // 2) Build new HTML (inject synchronously)
  const html = buildTwistHTML(type, title);
  root.innerHTML = html;

  // 3) Wait microtask so DOM settles
  queueMicrotask(() => {
    // 4) Force reflow so animations can restart clean
    void root.offsetWidth;

    // 5) Start animation
    root.classList.add("show");
  });
}

export function clearTwistAnimation(root) {
  if (!root) return;

  // Prevent removal during active animation loops
  root.classList.remove("show");

  // allow fade-out / animation-end to occur if defined in css
  setTimeout(() => {
    root.innerHTML = "";
  }, 50);
}

// ============================================================================
// HTML BUILDERS
// ============================================================================

function buildTwistHTML(type, title) {
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
   MONEY GUN — bill spray sideways
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
   BOMB — red shockwave
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
   HEAL — cross pulse
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
   GALAXY — vortex + starfield (overlay only)
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
