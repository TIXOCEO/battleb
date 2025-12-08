// ============================================================================
// arena.js — BattleBox Arena Overlay (BUILD v9.1.1 — BROADCAST MODE + MESSAGE LAYER)
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

// ⭐ NEW: Simple twist message system
import { initTwistMessage } from "/overlays/arena/twistMessage.js";

initEventRouter();
initTwistMessage();

/* ============================================================================ */
/* DOM refs                                                                    */
/* ============================================================================ */

const root = document.getElementById("arena-root");
const hudRound = document.getElementById("hud-round");
const hudType = document.getElementById("hud-type");
const hudTimer = document.getElementById("hud-timer");
const hudRing = document.getElementById("hud-ring-progress");
const playersContainer = document.getElementById("arena-players");

const twistOverlay = document.getElementById("twist-takeover");
const twistCountdown = document.getElementById("twist-countdown");
const twistTargetLayer = document.getElementById("twist-target");

const EMPTY_AVATAR =
  "https://cdn.vectorstock.com/i/1000v/43/93/default-avatar-photo-placeholder-icon-grey-vector-38594393.jpg";

// NEW:
const messageBox = document.getElementById("twist-message");
const bombBlur = document.getElementById("bomb-blur");

/* ============================================================================ */
/* Positions                                                                    */
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
/* Helpers                                                                      */
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

function waitAnimationEnd(el) {
  return new Promise((resolve) => {
    let timeout = setTimeout(resolve, 450);
    el.addEventListener(
      "animationend",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}

/* ============================================================================ */
/* Player cards                                                                 */
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

/* ============================================================================ */
/* Render loop                                                                   */
/* ============================================================================ */

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

/* ============================================================================ */
/* Status                                                                        */
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
    return el.classList.add((p.breakerHits ?? 0) > 0 ? "status-immune-broken" : "status-immune");
  }

  el.classList.add("status-alive");
}

/* ============================================================================ */
/* Positioning                                                                   */
/* ============================================================================ */

function positionCard(el, pos) {
  const dx = pos.x * RADIUS;
  const dy = pos.y * RADIUS;
  el.style.left = `${CENTER_X + dx - 80}px`;
  el.style.top = `${CENTER_Y + dy - 80}px`;
}

/* ============================================================================ */
/* Timer loop                                                                    */
/* ============================================================================ */

setInterval(() => {
  const raw = arenaStore.get();
  const state = raw.hud ? { ...raw, ...raw.hud } : raw;

  const now = Date.now();
  const remainingMs = Math.max(0, (state.endsAt ?? 0) - now);

  const sec = Math.floor(remainingMs / 1000);
  hudTimer.textContent =
    `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(
      2,
      "0"
    )}`;

  renderHudProgress(state, hudRing);
}, 100);

/* ============================================================================ */
/* Beam coord helper                                                             */
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
/* Twist router — Broadcast Mode                                                 */
/* ============================================================================ */

let animInProgress = false;

arenaTwistStore.subscribe(async (state) => {
  if (!state.active || !state.type) {
    if (!animInProgress) {
      FX.clear();
      clearTwistAnimation(twistOverlay);
      disableGalaxyChaos(cardRefs);
      twistTargetLayer.innerHTML = "";
    }
    return;
  }

  animInProgress = true;

  // NEW — Send simple message for ANY twist
  document.dispatchEvent(new CustomEvent("twist:message", { detail: state }));

  // NEW — BOM blur
  if (state.type === "bomb") {
    bombBlur.classList.add("show");
    setTimeout(() => bombBlur.classList.remove("show"), 3000);
  }

  // COUNTDOWN
  if (state.type === "countdown") {
    FX.add(new CountdownFX(state.step));
    return;
  }

  // TARGET
  if (state.targetIndex != null) {
    const c = getCardCenter(state.targetIndex);
    if (c) {
      FX.add(new TargetPulseFX(c.x, c.y));
      FX.add(new BeamFX(CENTER_X, CENTER_Y, c.x, c.y, getBeamColor(state.type)));
    }
    animateOnce(cardRefs[state.targetIndex].el, "target-flash");
  }

  // VICTIMS
  if (Array.isArray(state.victimIndices)) {
    state.victimIndices.forEach((i) => {
      const c = getCardCenter(i);
      if (c) FX.add(new VictimBlastFX(c.x, c.y));
      animateOnce(cardRefs[i].el, "victim-blast");
    });
  }

  // SURVIVOR
  if (state.survivorIndex != null) {
    const c = getCardCenter(state.survivorIndex);
    if (c) FX.add(new SurvivorShieldFX(c.x, c.y));
    animateOnce(cardRefs[state.survivorIndex].el, "survivor-glow");
  }

  // SPECIAL FX
  switch (state.type) {
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
    case "immune": {
      const c = getCardCenter(state.targetIndex);
      if (c) FX.add(new BeamFX(CENTER_X, CENTER_Y, c.x, c.y, "#00FFE5"));
      break;
    }
    case "heal": {
      const c = getCardCenter(state.targetIndex);
      if (c) FX.add(new BeamFX(CENTER_X, CENTER_Y, c.x, c.y, "#FFD84A"));
      break;
    }
  }

  // TITLE OVERLAY
  twistOverlay.classList.remove("hidden");
  playTwistAnimation(twistOverlay, state.type, state.title, state);

  await waitAnimationEnd(twistOverlay);

  if (state.type === "galaxy") {
    disableGalaxyChaos(cardRefs);
  }

  animInProgress = false;
});

/* ============================================================================ */
/* Beam color map                                                                */
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
/* Round events                                                                  */
/* ============================================================================ */

document.addEventListener("arena:roundStart", () => {
  animateOnce(root, "bb-round-start-shockwave");
});

document.addEventListener("arena:graceStart", () => {
  animateOnce(root, "bb-grace-pulse");
});

document.addEventListener("arena:roundEnd", () => {
  animateOnce(root, "bb-round-end-flash");
  disableGalaxyChaos(cardRefs);

  cardRefs.forEach((ref) => {
    if (ref.el.classList.contains("status-danger")) {
      animateOnce(ref.el, "bb-danger-pulse");
    }
  });

  animateOnce(hudRound, "bb-hud-elimination-flash");
});

/* ============================================================================ */
/* EXPORT                                                                        */
/* ============================================================================ */

export default {
  positionCard,
  applyStatus,
};
