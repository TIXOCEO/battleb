// ============================================================================
// arena.js — BattleBox Arena Overlay
// BUILD v9.3 — SAFE QUEUE, RESET-COMPATIBLE, MESSAGE-FIXED VERSION
// ============================================================================

import { initEventRouter } from "/overlays/shared/event-router.js";
import {
  arenaStore,
  arenaTwistStore,
  renderHudProgress,
} from "/overlays/arena/arenaStore.js";

import { playTwistAnimation, clearTwistAnimation } from "/overlays/shared/twistAnim.js";

import FX from "/overlays/shared/animation-engine.js";

// FX
import MoneyGunFX from "/overlays/shared/fx/MoneyGunFX.js";
import DiamondBlastFX from "/overlays/shared/fx/DiamondBlastFX.js";
import BombFX from "/overlays/shared/fx/BombFX.js";
import CountdownFX from "/overlays/shared/fx/CountdownFX.js";
import TargetPulseFX from "/overlays/shared/fx/TargetPulseFX.js";
import VictimBlastFX from "/overlays/shared/fx/VictimBlastFX.js";
import SurvivorShieldFX from "/overlays/shared/fx/SurvivorShieldFX.js";
import GalaxyFX from "/overlays/shared/fx/GalaxyFX.js";
import BeamFX from "/overlays/shared/fx/BeamFX.js";
import { enableGalaxyChaos, disableGalaxyChaos } from "/overlays/shared/galaxy-chaos.js";

// SIMPLE MESSAGE SYSTEM
import { initTwistMessage } from "/overlays/arena/twistMessage.js";

initEventRouter();
initTwistMessage();

/* ============================================================================ */
/* DOM refs */
/* ============================================================================ */

const root = document.getElementById("arena-root");
const hudRound = document.getElementById("hud-round");
const hudType = document.getElementById("hud-type");
const hudTimer = document.getElementById("hud-timer");
const hudRing = document.getElementById("hud-ring-progress");
const playersContainer = document.getElementById("arena-players");

const twistOverlay = document.getElementById("twist-takeover");
const twistTargetLayer = document.getElementById("twist-target");

// MESSAGE + BLUR LAYERS
const bombBlur = document.getElementById("bomb-blur");

const EMPTY_AVATAR =
  "https://cdn.vectorstock.com/i/1000v/43/93/default-avatar-photo-placeholder-icon-grey-vector-38594393.jpg";

/* ============================================================================ */
/* Positions */
/* ============================================================================ */

const POSITIONS = [
  { idx: 1, x: 0.0, y: -1.0 },
  { idx: 2, x: 0.7071, y: -0.7071 },
  { idx: 3, x: 1.0, y: 0.0 },
  { idx: 4, x: 0.7071, y: 0.7071 },
  { idx: 5, x: 0.0, y: 1.0 },
  { idx: 6, x: -0.7071, y: 0.7071 },
  { idx: 7, x: -1.0, y: 0.0 },
  { idx: 8, x: -0.7071, y: -0.7071 },
];

const CENTER_X = 600;
const CENTER_Y = 400;
const RADIUS = 300;

/* ============================================================================ */
/* Helpers */
/* ============================================================================ */

function animateOnce(el, className) {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  el.addEventListener("animationend", () => el.classList.remove(className), {
    once: true,
  });
}

function waitForAnimation(el) {
  return new Promise((resolve) => {
    let t = setTimeout(resolve, 500);
    el.addEventListener(
      "animationend",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true }
    );
  });
}

/* ============================================================================ */
/* Player cards */
/* ============================================================================ */

const cardRefs = [];

function createPlayerCards() {
  playersContainer.innerHTML = "";
  cardRefs.length = 0;

  for (let i = 0; i < 8; i++) {
    const card = document.createElement("div");
    card.className = "bb-player-card";

    const bg = document.createElement("div");
    bg.className = "bb-player-bgavatar";

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

    card.appendChild(bg);
    card.appendChild(pos);
    card.appendChild(labels);

    playersContainer.appendChild(card);

    cardRefs.push({ el: card, bg, name, score, pos });
  }
}

createPlayerCards();

/* ============================================================================ */
/* Render loop */
/* ============================================================================ */

arenaStore.subscribe((state) => {
  hudRound.textContent = `RONDE ${state.round}`;
  hudType.textContent = state.type === "finale" ? "FINALE" : "KWARTFINALE";

  const players = state.players;

  for (let i = 0; i < 8; i++) {
    const ref = cardRefs[i];
    const p = players[i];

    if (!p) {
      ref.name.textContent = "LEEG";
      ref.score.textContent = "0";
      ref.bg.style.backgroundImage = `url(${EMPTY_AVATAR})`;
      resetStatus(ref.el);
      positionCard(ref.el, POSITIONS[i]);
      continue;
    }

    ref.name.textContent = p.display_name;
    ref.score.textContent = p.score;
    ref.bg.style.backgroundImage = `url(${p.avatar_url || EMPTY_AVATAR})`;

    applyStatus(ref.el, p);
    positionCard(ref.el, POSITIONS[i]);
  }
});

/* ============================================================================ */
/* Status */
/* ============================================================================ */

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

/* ============================================================================ */
/* Card positioning */
/* ============================================================================ */

function positionCard(el, pos) {
  const dx = pos.x * RADIUS;
  const dy = pos.y * RADIUS;

  el.style.left = `${CENTER_X + dx - 80}px`;
  el.style.top = `${CENTER_Y + dy - 80}px`;
}

/* ============================================================================ */
/* Timer */
/* ============================================================================ */

setInterval(() => {
  const st = arenaStore.get();
  const now = Date.now();
  const remaining = Math.max(0, (st.endsAt ?? 0) - now);

  const sec = Math.floor(remaining / 1000);
  hudTimer.textContent = `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(
    sec % 60
  ).padStart(2, "0")}`;

  renderHudProgress(st, hudRing);
}, 100);

/* ============================================================================ */
/* Helper: get card center */
/* ============================================================================ */

function getCardCenter(index) {
  if (index == null) return null;
  const ref = cardRefs[index];
  if (!ref) return null;

  const rect = ref.el.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();

  return {
    x: rect.left + rect.width / 2 - rootRect.left,
    y: rect.top + rect.height / 2 - rootRect.top,
  };
}

/* ============================================================================ */
/* MAIN TWIST HANDLER — QUEUE-SAFE & RESET-SAFE */
/* ============================================================================ */

arenaTwistStore.subscribe(async (st) => {
  if (!st.active || !st.type) return;

  // MESSAGE FIRST
  document.dispatchEvent(new CustomEvent("twist:message", { detail: st.payload }));

  // Bomb blur
  if (st.type === "bomb") {
    bombBlur.classList.add("show");
    setTimeout(() => bombBlur.classList.remove("show"), 3000);
  }

  // CLEAR FX + cleanup before new twist
  FX.clear();
  twistTargetLayer.innerHTML = "";

  // COUNTDOWN MODE
  if (st.type === "countdown") {
    FX.add(new CountdownFX(st.step));
    setTimeout(() => arenaTwistStore.clear(), 600);
    return;
  }

  // TARGET FX
  if (st.payload?.targetIndex != null) {
    const c = getCardCenter(st.payload.targetIndex);
    if (c) {
      FX.add(new TargetPulseFX(c.x, c.y));
      FX.add(new BeamFX(CENTER_X, CENTER_Y, c.x, c.y, getBeamColor(st.type)));
    }
    animateOnce(cardRefs[st.payload.targetIndex].el, "target-flash");
  }

  // VICTIMS FX
  if (Array.isArray(st.payload?.victimIndices)) {
    st.payload.victimIndices.forEach((i) => {
      const c = getCardCenter(i);
      if (c) FX.add(new VictimBlastFX(c.x, c.y));
      animateOnce(cardRefs[i].el, "victim-blast");
    });
  }

  // SURVIVOR FX
  if (st.payload?.survivorIndex != null) {
    const c = getCardCenter(st.payload.survivorIndex);
    if (c) FX.add(new SurvivorShieldFX(c.x, c.y));
    animateOnce(cardRefs[st.payload.survivorIndex].el, "survivor-glow");
  }

  // SPECIAL FX
  switch (st.type) {
    case "moneygun":
      FX.add(new MoneyGunFX());
      break;
    case "diamond":
      FX.add(new DiamondBlastFX());
      break;
    case "bomb":
      FX.add(new BombFX());
      break;
    case "galaxy":
      FX.add(new GalaxyFX());
      enableGalaxyChaos(cardRefs);
      break;
  }

  // TITLE CARD
  twistOverlay.classList.remove("hidden");
  playTwistAnimation(twistOverlay, st.type, st.title, st.payload);

  await waitForAnimation(twistOverlay);

  // ALWAYS cleanup
  disableGalaxyChaos(cardRefs);
  clearTwistAnimation(twistOverlay);

  // CRITICAL: queue-safe clear → starts next twist
  arenaTwistStore.clear();
});

/* ============================================================================ */
/* Beam colors */
/* ============================================================================ */

function getBeamColor(type) {
  switch (type) {
    case "moneygun":
      return "#00FF80";
    case "diamond":
      return "#00CFFF";
    case "immune":
      return "#00FFE5";
    case "heal":
      return "#FFD84A";
    default:
      return "#FFFFFF";
  }
}

/* ============================================================================ */
/* Round events */
/* ============================================================================ */

document.addEventListener("arena:roundStart", () => {
  animateOnce(root, "bb-round-start-shockwave");
  FX.clear();
  disableGalaxyChaos(cardRefs);
});

document.addEventListener("arena:graceStart", () => {
  animateOnce(root, "bb-grace-pulse");
  FX.clear();
  disableGalaxyChaos(cardRefs);
});

document.addEventListener("arena:roundEnd", () => {
  animateOnce(root, "bb-round-end-flash");
  FX.clear();
  disableGalaxyChaos(cardRefs);

  cardRefs.forEach((ref) => {
    if (ref.el.classList.contains("status-danger")) {
      animateOnce(ref.el, "bb-danger-pulse");
    }
  });

  animateOnce(hudRound, "bb-hud-elimination-flash");
});

/* ============================================================================ */
/* EXPORT */
/* ============================================================================ */

export default {
  positionCard,
  applyStatus,
};
