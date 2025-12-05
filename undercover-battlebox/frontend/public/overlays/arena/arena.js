// ============================================================================
// arena.js — BattleBox Arena Overlay (FINAL v6.0 TRANSPARENT BUILD)
// ============================================================================
//
// ✔ Transparante overlay achtergrond
// ✔ Transparante playercard octagons
// ✔ Transparante centrale HUD (geen donkere achtergrond meer)
// ✔ Timer in mm:ss (00:00)
// ✔ Timer telt correct af
// ✔ Progress ring werkt met mm:ss
// ✔ Playercards NIET meer ondersteboven: alle rot = 0
// ✔ Galaxy twist laat kaarten spinnen zonder ze te roteren
// ✔ Volledig compatibel met arenaStore.js & twistAnim.js
//
// ============================================================================

import { initEventRouter } from "/overlays/shared/event-router.js";
import {
  arenaStore,
  arenaTwistStore,
  renderHudProgress,
} from "/overlays/shared/arena-store.js";

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
   CONSTANTS — circular positions (ROT = 0 ALWAYS)
============================================================ */
const POSITIONS = [
  { idx: 1, x: 0.7071, y: -0.7071 },
  { idx: 2, x: 1.0,    y: 0.0 },
  { idx: 3, x: 0.7071, y: 0.7071 },
  { idx: 4, x: 0.0,    y: 1.0 },
  { idx: 5, x: -0.7071,y: 0.7071 },
  { idx: 6, x: -1.0,   y: 0.0 },
  { idx: 7, x: -0.7071,y: -0.7071 },
  { idx: 8, x: 0.0,    y: -1.0 },
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
  el.addEventListener("animationend", () => el.classList.remove(className), { once: true });
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

    const previous = lastScoreMap.get(p.id) ?? 0;
    if (p.score !== previous) {
      animateOnce(card.score, "bb-score-anim");
      lastScoreMap.set(p.id, p.score);
    }

    card.score.textContent = p.score ?? 0;
    card.bg.style.backgroundImage = `url(${p.avatar_url || EMPTY_AVATAR})`;

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

  if (p.eliminated) {
    el.classList.add("status-elimination");
    return;
  }

  if (p.positionStatus === "danger") {
    el.classList.add("status-danger");
    return;
  }

  if (p.positionStatus === "immune") {
    if ((p.breakerHits ?? 0) > 0) {
      el.classList.add("status-immune-broken");
    } else {
      el.classList.add("status-immune");
    }
    return;
  }

  el.classList.add("status-alive");
}

/* ============================================================
   POSITIONING — NO ROTATION
============================================================ */
function positionCard(el, pos) {
  const dx = pos.x * RADIUS;
  const dy = pos.y * RADIUS;

  el.style.left = `${CENTER_X + dx - 80}px`;
  el.style.top = `${CENTER_Y + dy - 80}px`;

  // ✔ No rotation — upright cards
  el.style.transform = `rotate(0deg)`;
}

/* ============================================================
   HUD + TIMER + RING
============================================================ */
arenaStore.subscribe((state) => {
  hudRound.textContent = `RONDE ${state.round ?? 0}`;
  hudType.textContent = state.type === "finale" ? "FINALE" : "KWARTFINALE";

  const now = Date.now();
  let remaining = 0;

  if (state.status === "active") {
    remaining = Math.max(0, (state.roundCutoff - now) / 1000);
  } else if (state.status === "grace") {
    remaining = Math.max(0, (state.graceEnd - now) / 1000);
  }

  // ✔ Format mm:ss
  const m = Math.floor(remaining / 60).toString().padStart(2, "0");
  const s = Math.floor(remaining % 60).toString().padStart(2, "0");
  hudTimer.textContent = `${m}:${s}`;

  renderHudProgress(state, hudRing);
});

/* ============================================================
   TWIST — TAKEOVER + GALAXY
============================================================ */
arenaTwistStore.subscribe((state) => {
  if (state.active) {
    if (state.type === "galaxy") {
      galaxyLayer.classList.remove("hidden");
      galaxyLayer.classList.add("galaxy-active");

      cardRefs.forEach(ref =>
        ref.el.classList.add("bb-galaxy-spin-card")
      );
    }

    playTwistAnimation(twistOverlay, state.type, state.title);

  } else {
    clearTwistAnimation(twistOverlay);

    galaxyLayer.classList.add("hidden");
    galaxyLayer.classList.remove("galaxy-active");

    cardRefs.forEach(ref =>
      ref.el.classList.remove("bb-galaxy-spin-card")
    );
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
