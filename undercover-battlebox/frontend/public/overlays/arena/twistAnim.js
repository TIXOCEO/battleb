// ============================================================================
// twistAnim.js — BattleBox Arena Twist Animation Engine v1.2 FINAL
// ============================================================================
//
// Supported animations:
//  • diamond   → exploding diamond shard blast
//  • moneygun  → sideways bill spray
//  • bomb      → red shockwave detonation
//  • immune    → soft green healing aura
//  • heal      → cross-symbol pulse
//  • galaxy    → full vortex spin + starfield (overlay only)
//
// This engine ONLY renders animations.
// Game engine handles all state, scoring, ranking, flipping, immunity, etc.
// ============================================================================

export function playTwistAnimation(root, type, title = "") {
  root.innerHTML = buildTwistHTML(type, title);

  requestAnimationFrame(() => {
    root.classList.add("show");
  });
}

export function clearTwistAnimation(root) {
  root.classList.remove("show");
  root.innerHTML = "";
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
//  Game engine flips players; overlay just animates
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
