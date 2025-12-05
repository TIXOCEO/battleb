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
   CONSTANTS — for card placement
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
  el.classList.remove(className);
  void el.offsetWidth; // force reflow
  el.classList.add(className);

  el.addEventListener(
    "animationend",
    () => el.classList.remove(className),
    { once: true }
  );
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

    // Background avatar layer
    const bg = document.createElement("div");
    bg.className = "bb-player-bgavatar";
    card.appendChild(bg);

    // Foreground labels
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
   UPDATE PLAYER CARDS FROM arenaStore
============================================================ */
arenaStore.subscribe((state) => {
  const players = state.players || [];

  for (let i = 0; i < 8; i++) {
    const card = cardRefs[i];
    const data = players[i];

    /* =============================
       CARD EMPTY
    ============================= */
    if (!data) {
      card.name.textContent = "LEEG";
      card.score.textContent = "0";
      card.bg.style.backgroundImage = `url(${EMPTY_AVATAR})`;

      resetStatus(card.el);

      // mark as empty → triggers join animation next time filled
      lastCardOccupied[i] = false;

      positionCard(card.el, POSITIONS[i]);
      continue;
    }

    /* =============================
       UPDATE NAME + SCORE + AVATAR
    ============================= */
    card.name.textContent = data.display_name || "Onbekend";

    const lastScore = lastScoreMap.get(data.id) ?? 0;
    if (data.score !== lastScore) {
      animateOnce(card.score, "bb-score-anim");
      lastScoreMap.set(data.id, data.score);
    }

    card.score.textContent = data.score ?? 0;
    card.bg.style.backgroundImage = `url(${data.avatar_url || EMPTY_AVATAR})`;

    /* JOIN POP ANIM */
    if (!lastCardOccupied[i]) {
      animateOnce(card.el, "bb-join-pop");
      lastCardOccupied[i] = true;
    }

    /* APPLY STATUS CLASS */
    applyStatus(card.el, data);

    /* POSITIONING */
    positionCard(card.el, POSITIONS[i]);
  }
});

/* ============================================================
   STATUS SYSTEM + ANIMATIONS
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

  // Eliminated
  if (p.eliminated) {
    el.classList.add("status-elimination");
    animateOnce(el, "bb-elim-flash");       // 🔥 elim flash
    return;
  }

  // Danger
  if (p.positionStatus === "danger") {
    el.classList.add("status-danger");
    animateOnce(el, "bb-danger-pulse");     // 🔥 danger pulse
    return;
  }

  // Immune
  if (p.positionStatus === "immune") {
    if ((p.breakerHits ?? 0) > 0) {
      el.classList.add("status-immune-broken");
      animateOnce(el, "bb-immune-broken-blink");   // 🔥 broken immunity blink
    } else {
      el.classList.add("status-immune");
      animateOnce(el, "bb-immune-glow");            // 🔥 immune glow
    }
    return;
  }

  // Alive
  el.classList.add("status-alive");
  animateOnce(el, "bb-alive-pulse");               // subtle pulse
}

/* ============================================================
   POSITIONING — translate into full circle
============================================================ */
function positionCard(el, pos) {
  const dx = pos.x * RADIUS;
  const dy = pos.y * RADIUS;

  // Apply translate
  el.style.left = `${CENTER_X + dx - 80}px`;
  el.style.top = `${CENTER_Y + dy - 80}px`;

  // Rotate toward center
  el.style.transform = `rotate(${pos.rot}deg)`;
}

/* ============================================================
   HUD RENDERING + ROUND TIMER
============================================================ */
arenaStore.subscribe((state) => {
  hudRound.textContent = `RONDE ${state.round ?? 0}`;
  hudType.textContent =
    state.type === "finale" ? "FINALE" : "KWARTFINALE";

  const now = Date.now();
  let remaining = 0;

  if (state.status === "active") {
    remaining = Math.max(0, Math.floor((state.roundCutoff - now) / 1000));
  } else if (state.status === "grace") {
    remaining = Math.max(0, Math.floor((state.graceEnd - now) / 1000));
  }

  hudTimer.textContent = remaining.toString().padStart(2, "0");

  // Update HUD progress ring
  renderHudProgress(state, hudRing);

  /* ROUND START SHOCKWAVE */
  if (state.status === "active" && remaining === state.settings.roundDurationPre) {
    shockwaveHUD();
  }
});

/* ============================================================
   HUD SHOCKWAVE EFFECT
============================================================ */
function shockwaveHUD() {
  animateOnce(container, "bb-round-start-shockwave");
}

/* ============================================================
   TWIST TAKEOVER MODE (full-screen event)
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
   ROUND / GRACE / END EVENT HOOKS
============================================================ */
document.addEventListener("arena:roundStart", () => {
  // Shockwave + pulse
  shockwaveHUD();
  animateOnce(container, "bb-round-start-shake");
});

document.addEventListener("arena:graceStart", () => {
  animateOnce(container, "bb-grace-pulse");
});

document.addEventListener("arena:roundEnd", () => {
  animateOnce(container, "bb-round-end-flash");
});

/* ============================================================
   OPTIONAL: LISTEN TO SOCKET EVENTS
   (event-router forwards them as DOM events)
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
   EXPORTS (if needed)
============================================================ */
export default {
  positionCard,
  applyStatus,
  shockwaveHUD,
};
