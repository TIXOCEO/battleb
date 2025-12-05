
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
  { idx: 2, x: 1.0, y: 0.0, rot: 0 },
  { idx: 3, x: 0.7071, y: 0.7071, rot: 45 },
  { idx: 4, x: 0.0, y: 1.0, rot: 90 },
  { idx: 5, x: -0.7071, y: 0.7071, rot: 135 },
  { idx: 6, x: -1.0, y: 0.0, rot: 180 },
  { idx: 7, x: -0.7071, y: -0.7071, rot: -135 },
  { idx: 8, x: 0.0, y: -1.0, rot: -90 },
];

const CENTER_X = 600;
const CENTER_Y = 400;
const RADIUS = 300;

const EMPTY_AVATAR =
  "https://cdn.vectorstock.com/i/1000v/43/93/default-avatar-photo-placeholder-icon-grey-vector-38594393.jpg";

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
       CARD VISIBLE / EMPTY
    ============================= */
    if (!data) {
      card.name.textContent = "LEEG";
      card.score.textContent = "0";
      card.bg.style.backgroundImage = `url(${EMPTY_AVATAR})`;
      resetStatus(card.el);
      positionCard(card.el, POSITIONS[i]);
      continue;
    }

    /* =============================
       UPDATE CONTENT
    ============================= */
    card.name.textContent = data.display_name || "Onbekend";
    card.score.textContent = data.score ?? 0;

    card.bg.style.backgroundImage = `url(${data.avatar_url || EMPTY_AVATAR})`;

    /* =============================
       STATUS CLASS
    ============================= */
    applyStatus(card.el, data);

    /* =============================
       POSITION + ROTATION
    ============================= */
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
    return;
  }

  if (p.positionStatus === "danger") {
    el.classList.add("status-danger");
    return;
  }

  if (p.positionStatus === "immune") {
    // Broken immunity if breakerHits = 1
    if ((p.breakerHits ?? 0) > 0) {
      el.classList.add("status-immune-broken");
    } else {
      el.classList.add("status-immune");
    }
    return;
  }

  // Default = alive
  el.classList.add("status-alive");
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
   HUD RENDERING
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

  hudTimer.textContent = remaining;

  // Update HUD progress ring
  renderHudProgress(state, hudRing);
});

/* ============================================================
   TWIST TAKEOVER MODE
============================================================ */
arenaTwistStore.subscribe((state) => {
  if (state.active) {
    twistOverlay.classList.add("show");
    twistOverlay.innerHTML = `
      <div style="
        font-size:72px;
        font-weight:900;
        color:var(--bb-orange);
        text-shadow:var(--glow-hard-orange);
      ">
        ${state.title || "TWIST ACTIVE"}
      </div>
    `;
  } else {
    twistOverlay.classList.remove("show");
    twistOverlay.innerHTML = "";
  }
});
