// ============================================================================
// arena.js — BattleBox Arena Overlay (BUILD v6.3 — TWIST QUEUE + HUD FIXES)
// ============================================================================
//
// Upgrades v6.3:
// ----------------------------------------------------
// ✔ TwistQueue support (animations play reliably in sequence)
// ✔ Twist overlay always visible during animation
// ✔ Animation-safe clear + after-animation wait
// ✔ HUD timer/grace fallback fixed
// ✔ Galaxy activation fixed
// ✔ No visual glitches when multiple twists come fast
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
  clearTwistAnimation
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
const twistOverlay = document.getElementById("twist-takeover");
const galaxyLayer = document.getElementById("twist-galaxy");

/* ============================================================
   POSITIONS — #1 at TOP
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

const EMPTY_AVATAR =
  "https://cdn.vectorstock.com/i/1000v/43/93/default-avatar-photo-placeholder-icon-grey-vector-38594393.jpg";

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

// Wait until twist animation is finished before clearing
function waitAnimationEnd(root) {
  return new Promise((resolve) => {
    const cleanup = () => {
      root.removeEventListener("animationend", cleanup);
      resolve();
    };
    root.addEventListener("animationend", cleanup);
    setTimeout(resolve, 1200); // fail-safe fallback
  });
}

const lastScoreMap = new Map();
const lastCardOccupied = Array(8).fill(false);

/* ============================================================
   CARD CREATION
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
   PLAYER CARD RENDERING
============================================================ */
arenaStore.subscribe((state) => {
  hudRound.textContent = `RONDE ${state.round}`;
  hudType.textContent = state.type?.toUpperCase() ?? "KWARTFINALE";

  const players = state.players || [];

  for (let i = 0; i < 8; i++) {
    const card = cardRefs[i];
    const p = players[i];

    if (!p) {
      card.name.textContent = "LEEG";
      card.score.textContent = "0";
      card.bg.style.backgroundImage = `url(${EMPTY_AVATAR})`;
      resetStatus(card.el);
      lastCardOccupied[i] = false;
      positionCard(card.el, POSITIONS[i]);
      continue;
    }

    card.name.textContent = p.display_name ?? "Onbekend";

    // Score animation
    const previous = lastScoreMap.get(p.id) ?? 0;
    if (p.score !== previous) {
      animateOnce(card.score, "bb-score-anim");
      lastScoreMap.set(p.id, p.score);
    }
    card.score.textContent = p.score ?? 0;

    // Avatar
    const avatar = p.avatar_url || p.avatar || EMPTY_AVATAR;
    card.bg.style.backgroundImage = `url(${avatar})`;

    // Join animation
    if (!lastCardOccupied[i]) {
      animateOnce(card.el, "bb-join-pop");
      lastCardOccupied[i] = true;
    }

    applyStatus(card.el, p);
    positionCard(card.el, POSITIONS[i]);
  }
});

/* ============================================================
   STATUS HANDLING
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
      (p.breakerHits ?? 0) > 0 ? "status-immune-broken" : "status-immune"
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
  el.style.transform = "rotate(0deg)";
}

/* ============================================================
   TIMER LOOP
============================================================ */
setInterval(() => {
  const raw = arenaStore.get();
  const state = raw.hud ? { ...raw, ...raw.hud } : raw;

  const now = Date.now();

  let totalMs = state.totalMs ?? 0;
  let remainingMs = state.remainingMs ?? (state.endsAt - now);

  // Fallbacks
  if (!totalMs || totalMs <= 0) {
    if (state.status === "active") {
      totalMs = state.settings.roundDurationPre * 1000;
      remainingMs = Math.max(0, state.roundCutoff - now);
    } else if (state.status === "grace") {
      totalMs = 5000;
      remainingMs = Math.max(0, state.graceEnd - now);
    }
  }

  remainingMs = Math.max(0, remainingMs);

  // Timer text
  const sec = Math.floor(remainingMs / 1000);
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  hudTimer.textContent = `${mm}:${ss}`;

  renderHudProgress(state, hudRing);
}, 100);

/* ============================================================
   TWISTS — v6.3 (QUEUE SAFE)
============================================================ */

// prevent double-clear during animation
let animInProgress = false;

arenaTwistStore.subscribe(async (state) => {
  if (state.active && state.type) {
    animInProgress = true;

    // Galaxy background enable
    if (state.type === "galaxy") {
      galaxyLayer.classList.remove("hidden");
      galaxyLayer.classList.add("galaxy-active");
    }

    twistOverlay.classList.remove("hidden");

    playTwistAnimation(twistOverlay, state.type, state.title);

    await waitAnimationEnd(twistOverlay);

    animInProgress = false;
  } else {
    if (!animInProgress) {
      clearTwistAnimation(twistOverlay);
      twistOverlay.classList.add("hidden");
      galaxyLayer.classList.add("hidden");
      galaxyLayer.classList.remove("galaxy-active");
    }
  }
});

/* ============================================================
   ROUND EVENTS
============================================================ */
document.addEventListener("arena:roundStart", () => {
  animateOnce(root, "bb-round-start-shake");
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
