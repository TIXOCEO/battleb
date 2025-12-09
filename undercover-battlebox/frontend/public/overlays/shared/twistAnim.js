// ============================================================================
// twistAnim.js — BattleBox Arena Twist Animation Engine v8.0 LITE EDITION
// OBS-PROOF • NO HEAVY FX • NO AUTO-GALAXY • ONLY TITLE OVERLAY
// ============================================================================
//
// LITE MODE FEATURES:
// ------------------------------------------------------------
// ✔ Alleen titel-overlay wordt getoond (twistMessage staat elders)
// ✔ Geen shards / bills / vortex / pulsars → geen CPU belasting
// ✔ Geen auto-fade galaxy (arena.js regelt timing zelf)
// ✔ HTML build blijft bestaan voor compatibiliteit
// ✔ Volledige double-RAF reflow zodat OBS het pakt
// ✔ Geen ghosting dankzij detachContent
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
// MAIN FULLSCREEN TWIST ANIMATION (LITE)
// ============================================================================

export function playTwistAnimation(root, type, title = "", payload = {}) {
  if (!root) return;

  // reset overlay
  root.classList.remove("show");
  detachContent(root);

  // inject only simple HTML
  root.innerHTML = buildTwistHTML(type, title);

  // double-RAF to satisfy OBS rendering pipeline
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
  }, 250); // iets korter, LITE is sneller
}


// ============================================================================
// COUNTDOWN (LITE)
// ============================================================================

export function playCountdown(root, step = 3) {
  if (!root) return;

  root.classList.remove("show");
  detachContent(root);
  root.innerHTML = renderCountdownHTML(step);

  requestAnimationFrame(() => {
    forceReflow(root);
    requestAnimationFrame(() => root.classList.add("show"));
  });
}

function renderCountdownHTML(step) {
  return `
    <div class="twist-anim twist-lite-countdown">
      <div class="count-number">${step}</div>
    </div>
  `;
}


// ============================================================================
// FULL HTML BUILDERS — LITE EDITION
// ============================================================================

function buildTwistHTML(type, title) {
  // In LITE mode: type maakt niet uit → we tonen alleen titel
  return `
    <div class="twist-anim twist-lite">
      <div class="twist-title">${title}</div>
    </div>
  `;
}
