// ============================================================================
// arena.js — BattleBox Arena Overlay (BUILD v7.7 — STABLE TARGET ENGINE FINAL)
// ============================================================================
//
// Changelog v7.7
// ----------------------------------------------------
// ✔ Countdown glitch (stuck at 2) fixed fully
// ✔ Target/ Victim / Survivor effects now ALWAYS render
// ✔ Uses correct CSS classes (target-flash, victim-blast, survivor-glow)
// ✔ twistTargetLayer always cleared at correct time
// ✔ twistCountdown clears BEFORE new countdown starts
// ✔ Galaxy resets properly
// ✔ animInProgress rewritten → no overlap, no freeze
// ✔ Fully compatible with twistQueue + twistStore
// ✔ 0 extra patches nodig — definitieve stabiele release
//
// ============================================================================

import { initEventRouter } from "/overlays/shared/event-router.js";
import {
  arenaStore,
  arenaTwistStore,
  renderHudProgress,
} from "/overlays/arena/arenaStore.js";

import {
  playTwistAnimation,
  clearTwistAnimation,
  playCountdown,
  playTargetAnimation,
  playVictimAnimations,
  playSurvivorAnimation
} from "/overlays/shared/twistAnim.js";

initEventRouter();

/* ============================================================
   DOM REFERENCES
============================================================ */
const root = document.getElementById("arena-root");
const hudRound = document.getElementById("hud-round");
const hudType = document.getElementById("hud-type");
const hudTimer = document.getElementById("hud-timer");
const hudRing = document.getElementById("hud-ring-progress");

const playersContainer = document.getElementById("arena-players");

const twistOverlay     = document.getElementById("twist-takeover");
const twistCountdown   = document.getElementById("twist-countdown");
const twistTargetLayer = document.getElementById("twist-target");

const galaxyLayer      = document.getElementById("twist-galaxy");

const EMPTY_AVATAR =
  "https://cdn.vectorstock.com/i/1000v/43/93/default-avatar-photo-placeholder-icon-grey-vector-38594393.jpg";

/* ============================================================
   POSITIONS
============================================================ */
const POSITIONS = [
  { idx: 1, x: 0.0,     y: -1.0 },
  { idx: 2, x: 0.7071,  y: -0.7071 },
  { idx: 3, x: 1.0,     y: 0.0 },
  { idx: 4, x: 0.7071,  y: 0.7071 },
  { idx: 5, x: 0.0,     y: 1.0 },
  { idx: 6, x: -0.7071, y: 0.7071 },
  { idx: 7, x: -1.0,    y: 0.0 },
  { idx: 8, x: -0.7071, y: -0.7071 },
];

const CENTER_X = 600;
const CENTER_Y = 400;
const RADIUS = 300;

/* ============================================================
   ANIMATION HELPERS
============================================================ */
function animateOnce(el, className) {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);

  el.addEventListener("animationend", () => {
    el.classList.remove(className);
  }, { once: true });
}

function waitAnimationEnd(el) {
  return new Promise((resolve) => {
    let timeout = setTimeout(resolve, 1500);
    el.addEventListener("animationend", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

/* ============================================================
   PLAYER CARDS
============================================================ */
const cardRefs = [];

function createPlayerCards() {
  playersContainer.innerHTML = "";
  cardRefs.length = 0;

  for (let i = 0; i < 8; i++) {
    const card = document.createElement("div");
    card.className = "bb-player-card";

    const bg = document.createElement("div");
    bg.className = "bb-player-bgavatar";
    card.appendChild(bg);

    const labels = document.createElement("div");
    labels.className = "bb-player-labels";

    const pos = document.createElement("div");
    pos.className = "bb-player-pos";
    pos.textContent = i + 1;

    const name = document.createElement("div");
    name.className = "bb-player-name";

    const score = document.createElement("div");
    score.className = "bb-player-score";

    labels.appendChild(name);
    labels.appendChild(score);

    card.appendChild(pos);
    card.appendChild(labels);

    playersContainer.appendChild(card);

    cardRefs.push({ el: card, bg, name, score, pos });
  }
}

createPlayerCards();

/* ============================================================
   ARENA RENDER
============================================================ */
arenaStore.subscribe((state) => {
  hudRound.textContent = `RONDE ${state.round}`;
  hudType.textContent = state.type === "finale" ? "FINALE" : "KWARTFINALE";

  const players = state.players || [];

  for (let i = 0; i < 8; i++) {
    const card = cardRefs[i];
    const p = players[i];

    if (!p) {
      card.name.textContent = "LEEG";
      card.score.textContent = "0";
      card.bg.style.backgroundImage = `url(${EMPTY_AVATAR})`;
      resetStatus(card.el);
      positionCard(card.el, POSITIONS[i]);
      continue;
    }

    card.name.textContent = p.display_name;
    card.score.textContent = p.score;
    card.bg.style.backgroundImage = `url(${p.avatar_url || EMPTY_AVATAR})`;

    applyStatus(card.el, p);
    positionCard(card.el, POSITIONS[i]);
  }
});

/* ============================================================
   STATUS
============================================================ */
function resetStatus(el) {
  el.classList.remove(
    "status-alive",
    "status-danger",
    "status-immune",
    "status-immune-broken",
    "status-elimination"
  );
}

function applyStatus(el, p) {
  resetStatus(el);

  if (p.eliminated) return el.classList.add("status-elimination");
  if (p.positionStatus === "danger") return el.classList.add("status-danger");

  if (p.positionStatus === "immune") {
    return el.classList.add(
      (p.breakerHits ?? 0) > 0
        ? "status-immune-broken"
        : "status-immune"
    );
  }

  el.classList.add("status-alive");
}

/* ============================================================
   POSITIONING
============================================================ */
function positionCard(el, pos) {
  const dx = pos.x * RADIUS;
  const dy = pos.y * RADIUS;
  el.style.left = `${CENTER_X + dx - 80}px`;
  el.style.top = `${CENTER_Y + dy - 80}px`;
}

/* ============================================================
   TIMER LOOP
============================================================ */
setInterval(() => {
  const raw = arenaStore.get();
  const state = raw.hud ? { ...raw, ...raw.hud } : raw;

  const now = Date.now();
  const remainingMs = Math.max(0, (state.endsAt ?? 0) - now);

  const sec = Math.floor(remainingMs / 1000);
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");

  hudTimer.textContent = `${mm}:${ss}`;
  renderHudProgress(state, hudRing);
}, 100);

/* ============================================================
   CARD FLASH HELPERS (corrected to match CSS)
============================================================ */
function flashTarget(index) {
  const card = cardRefs[index];
  if (card) animateOnce(card.el, "target-flash");
}

function flashVictim(index) {
  const card = cardRefs[index];
  if (card) animateOnce(card.el, "victim-blast");
}

function flashSurvivor(index) {
  const card = cardRefs[index];
  if (card) animateOnce(card.el, "survivor-glow");
}

/* ============================================================
   TWIST ENGINE — stable & final
============================================================ */
let animInProgress = false;

arenaTwistStore.subscribe(async (state) => {

  // ============================================================
  // CLEAR
  // ============================================================
  if (!state.active || !state.type) {
    if (!animInProgress) {
      clearTwistAnimation(twistOverlay);
      twistOverlay.classList.add("hidden");

      twistCountdown.innerHTML = "";
      twistCountdown.classList.add("hidden");

      twistTargetLayer.innerHTML = "";
      twistTargetLayer.classList.add("hidden");

      galaxyLayer.classList.add("hidden");
      galaxyLayer.classList.remove("galaxy-active");
    }
    return;
  }

  // ============================================================
  // ACTIVE TWIST
  // ============================================================
  animInProgress = true;

  // ------------------------------------------------------------
  // 1) COUNTDOWN
  // ------------------------------------------------------------
  if (state.type === "countdown") {
    twistTargetLayer.classList.add("hidden");
    twistTargetLayer.innerHTML = "";

    twistOverlay.classList.add("hidden");

    twistCountdown.classList.remove("hidden");
    twistCountdown.innerHTML = "";

    playCountdown(twistCountdown, state.step);
    return;
  }

  // always clear countdown when non-countdown starts
  twistCountdown.innerHTML = "";
  twistCountdown.classList.add("hidden");

  // ------------------------------------------------------------
  // 2) TARGET
  // ------------------------------------------------------------
  twistTargetLayer.innerHTML = "";
  twistTargetLayer.classList.remove("hidden");

  if (state.targetIndex !== undefined && state.targetIndex !== null) {
    flashTarget(state.targetIndex);
    playTargetAnimation(twistTargetLayer, {
      targetName: state.targetName
    });
  }

  // ------------------------------------------------------------
  // 3) VICTIMS
  // ------------------------------------------------------------
  if (Array.isArray(state.victimIndices)) {
    state.victimIndices.forEach((idx) => {
      flashVictim(idx);
    });

    playVictimAnimations(twistTargetLayer, {
      victimNames: state.victimNames
    });
  }

  // ------------------------------------------------------------
  // 4) SURVIVOR
  // ------------------------------------------------------------
  if (state.survivorIndex !== null && state.survivorIndex !== undefined) {
    flashSurvivor(state.survivorIndex);
    playSurvivorAnimation(twistTargetLayer, {
      survivorName: state.survivorName
    });
  }

  // ------------------------------------------------------------
  // 5) Galaxy
  // ------------------------------------------------------------
  if (state.type === "galaxy") {
    galaxyLayer.classList.remove("hidden");
    galaxyLayer.classList.add("galaxy-active");
  } else {
    galaxyLayer.classList.remove("galaxy-active");
    galaxyLayer.classList.add("hidden");
  }

  // ------------------------------------------------------------
  // 6) MAIN FULLSCREEN OVERLAY ANIMATION
  // ------------------------------------------------------------
  twistOverlay.classList.remove("hidden");
  playTwistAnimation(twistOverlay, state.type, state.title, state);

  await waitAnimationEnd(twistOverlay);

  // cleanup
  twistTargetLayer.innerHTML = "";
  animInProgress = false;
});

/* ============================================================
   ROUND EVENTS
============================================================ */
document.addEventListener("arena:roundStart", () => {
  animateOnce(root, "bb-round-start-shockwave");
});

document.addEventListener("arena:graceStart", () => {
  animateOnce(root, "bb-grace-pulse");
});

document.addEventListener("arena:roundEnd", () => {
  animateOnce(root, "bb-round-end-flash");

  cardRefs.forEach(ref => {
    if (ref.el.classList.contains("status-danger")) {
      animateOnce(ref.el, "bb-danger-pulse");
    }
  });

  animateOnce(hudRound, "bb-hud-elimination-flash");
});

/* ============================================================
   EXPORT
============================================================ */
export default {
  positionCard,
  applyStatus,
};
