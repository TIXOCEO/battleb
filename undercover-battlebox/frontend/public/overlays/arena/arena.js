// ============================================================================
// arena.js — BattleBox Arena Overlay (FINAL PATCHED BUILD)
// Implements:
// • Pop-in join animation
// • Score flash
// • Status glow states (alive, immune, immune-broken, danger, elimination)
// • Round-start shockwave
// • Grace pulse
// • Round-end flash + danger highlight + HUD ELIMINATIONS mode
// • Twist takeover fullscreen
// • Wall-clock HUD ring progress
// ============================================================================

import { initEventRouter } from "/overlays/shared/event-router.js";
import {
  arenaStore,
  arenaTwistStore,
  renderHudProgress,
} from "/overlays/arena/arenaStore.js";

initEventRouter();

/* ============================================================
   DOM REFERENCES
============================================================ */
const container = document.getElementById("arena-root");
const hudRound = document.getElementById("hud-round");
const hudType = document.getElementById("hud-type");
const hudTimer = document.getElementById("hud-timer");
const hudRing = document.getElementById("hud-ring-progress");

const playersContainer = document.getElementById("arena-players");
const twistOverlay = document.getElementById("twist-takeover");

/* ============================================================
   CONSTANTS — circular 8-card positioning
============================================================ */
const POSITIONS = [
  { idx: 1, x: 0.7071, y: -0.7071, rot: -45 },
  { idx: 2, x: 1.0,    y: 0.0,     rot: 0   },
  { idx: 3, x: 0.7071, y: 0.7071,  rot: 45  },
  { idx: 4, x: 0.0,    y: 1.0,     rot: 90  },
  { idx: 5, x: -0.7071,y: 0.7071,  rot: 135 },
  { idx: 6, x: -1.0,   y: 0.0,     rot: 180 },
  { idx: 7, x: -0.7071,y: -0.7071, rot: -135},
  { idx: 8, x: 0.0,    y: -1.0,    rot: -90 },
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
  void el.offsetWidth; // force reflow
  el.classList.add(className);
  el.addEventListener("animationend", () => el.classList.remove(className), { once: true });
}

const lastScoreMap = new Map();
const lastCardOccupied = Array(8).fill(false);

/* ============================================================
   CREATE 8 PLAYER CARDS
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
    name.textContent = "—";

    const score = document.createElement("div");
    score.className = "bb-player-score";
    score.textContent = "0";

    labels.appendChild(name);
    labels.appendChild(score);

    card.appendChild(pos);
    card.appendChild(labels);

    playersContainer.appendChild(card);

    cardRefs.push({
      el: card,
      bg,
      name,
      score,
      pos,
    });
  }
}

createPlayerCards();

/* ============================================================
   UPDATE PLAYER CARDS BASED ON STORE
============================================================ */
arenaStore.subscribe((state) => {
  const players = state.players || [];

  for (let i = 0; i < 8; i++) {
    const card = cardRefs[i];
    const data = players[i];

    if (!data) {
      card.name.textContent = "LEEG";
      card.score.textContent = "0";
      card.bg.style.backgroundImage = `url(${EMPTY_AVATAR})`;
      resetStatus(card.el);
      lastCardOccupied[i] = false;
      positionCard(card.el, POSITIONS[i]);
      continue;
    }

    card.name.textContent = data.display_name || "Onbekend";

    const lastScore = lastScoreMap.get(data.id) ?? 0;
    if (data.score !== lastScore) {
      animateOnce(card.score, "bb-score-anim");
      lastScoreMap.set(data.id, data.score);
    }

    card.score.textContent = data.score ?? 0;
    card.bg.style.backgroundImage = `url(${data.avatar_url || EMPTY_AVATAR})`;

    if (!lastCardOccupied[i]) {
      animateOnce(card.el, "bb-join-pop");
      lastCardOccupied[i] = true;
    }

    applyStatus(card.el, data);

    positionCard(card.el, POSITIONS[i]);
  }
});

/* ============================================================
   STATUS SYSTEM
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
    animateOnce(el, "bb-elim-flash");
    return;
  }

  if (p.positionStatus === "danger") {
    el.classList.add("status-danger");
    animateOnce(el, "bb-danger-pulse");
    return;
  }

  if (p.positionStatus === "immune") {
    if ((p.breakerHits ?? 0) > 0) {
      el.classList.add("status-immune-broken");
      animateOnce(el, "bb-immune-broken-blink");
    } else {
      el.classList.add("status-immune");
      animateOnce(el, "bb-immune-glow");
    }
    return;
  }

  el.classList.add("status-alive");
  animateOnce(el, "bb-alive-pulse");
}

/* ============================================================
   POSITIONING AROUND CENTER
============================================================ */
function positionCard(el, pos) {
  const dx = pos.x * RADIUS;
  const dy = pos.y * RADIUS;
  el.style.left = `${CENTER_X + dx - 80}px`;
  el.style.top = `${CENTER_Y + dy - 80}px`;
  el.style.transform = `rotate(${pos.rot}deg)`;
}

/* ============================================================
   HUD RENDERING
============================================================ */
arenaStore.subscribe((state) => {
  hudRound.textContent = `RONDE ${state.round ?? 0}`;
  hudType.textContent = state.type === "finale" ? "FINALE" : "KWARTFINALE";

  const now = Date.now();
  let remaining = 0;

  if (state.status === "active") {
    remaining = Math.max(0, Math.floor((state.roundCutoff - now) / 1000));
  } else if (state.status === "grace") {
    remaining = Math.max(0, Math.floor((state.graceEnd - now) / 1000));
  }

  hudTimer.textContent = remaining.toString().padStart(2, "0");

  renderHudProgress(state, hudRing);

  if (state.status === "active" && remaining === state.settings.roundDurationPre) {
    shockwaveHUD();
  }
});

/* ============================================================
   HUD EFFECTS
============================================================ */
function shockwaveHUD() {
  animateOnce(container, "bb-round-start-shockwave");
}

/* ============================================================
   TWIST TAKEOVER
============================================================ */
arenaTwistStore.subscribe((state) => {
  if (state.active) {
    twistOverlay.classList.add("show");
    animateOnce(twistOverlay, "bb-twist-flash");
    twistOverlay.innerHTML = `
      <div class="twist-takeover-title">
        ${state.title || "TWIST ACTIVE"}
      </div>
    `;
  } else {
    twistOverlay.classList.remove("show");
    twistOverlay.innerHTML = "";
  }
});

/* ============================================================
   ROUND EVENTS (FROM event-router)
============================================================ */
document.addEventListener("arena:roundStart", () => {
  shockwaveHUD();
  animateOnce(container, "bb-round-start-shake");
});

document.addEventListener("arena:graceStart", () => {
  animateOnce(container, "bb-grace-pulse");
});

document.addEventListener("arena:roundEnd", () => {
  animateOnce(container, "bb-round-end-flash");

  // Highlight danger players once more
  cardRefs.forEach((ref) => {
    if (ref.el.classList.contains("status-danger")) {
      animateOnce(ref.el, "bb-danger-pulse");
    }
  });

  // HUD elimination mode
  animateOnce(hudRound, "bb-hud-elimination-flash");
});

/* ============================================================
   SOCKET EVENTS (OPTIONAL)
============================================================ */
window.addEventListener("round:start", () => {
  shockwaveHUD();
});

window.addEventListener("round:grace", () => {
  animateOnce(container, "bb-grace-pulse");
});

window.addEventListener("round:end", () => {
  animateOnce(container, "bb-round-end-flash");
});

/* ============================================================
   EXPORT
============================================================ */
export default {
  positionCard,
  applyStatus,
  shockwaveHUD,
};
