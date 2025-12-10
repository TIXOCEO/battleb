// ============================================================================
// arena.js — BattleBox Arena Overlay
// BUILD v9.6 — LITE MODE (Galaxy Shuffle + Bomb Roulette) + Fade System
// + DEBUG LOGGING FOR TWIST MESSAGE PAYLOADS
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

import FX from "/overlays/shared/animation-engine.js";

// FX (unused in lite mode but kept)
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

import { initTwistMessage } from "/overlays/arena/twistMessage.js";

initEventRouter();

// FIX: init twist message AFTER DOM is ready
window.addEventListener("DOMContentLoaded", () => {
  initTwistMessage();
});

/* ============================================================================ */
/* DEBUG LOG #1 — Confirm twist store input                                    */
/* ============================================================================ */
arenaTwistStore.subscribe((st) => {
  if (!st.active) return;
  console.log("%c[TWIST STORE] incoming twist:", "color:#0af", st);
});

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

// FIX: element bestaat niet → crash voorkomen
const twistTargetLayer =
  document.getElementById("twist-target") || document.createElement("div");

const EMPTY_AVATAR = "https://i.imgur.com/x6v5tkX.jpeg";

/* ============================================================================ */
/* PlayerCard Fade Controls */
/* ============================================================================ */

function hidePlayerCards() {
  playersContainer.classList.add("fade-out");
}

function showPlayerCards() {
  playersContainer.classList.remove("fade-out");
  playersContainer.classList.add("fade-in");

  setTimeout(() => {
    playersContainer.classList.remove("fade-in");
  }, 450);
}

/* ============================================================================ */
/* Positions */
/* ============================================================================ */

const POSITIONS = [
  { x: 0.0, y: -1.0 },
  { x: 0.7071, y: -0.7071 },
  { x: 1.0, y: 0.0 },
  { x: 0.7071, y: 0.7071 },
  { x: 0.0, y: 1.0 },
  { x: -0.7071, y: 0.7071 },
  { x: -1.0, y: 0.0 },
  { x: -0.7071, y: -0.7071 },
];

const CENTER_X = 600;
const CENTER_Y = 400;
const RADIUS = 300;

/* ============================================================================ */
/* OBS-SAFE Animation Helper */
/* ============================================================================ */

function animateOnce(el, className) {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth;
  requestAnimationFrame(() => el.classList.add(className));
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
  hudTimer.textContent =
    `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(
      sec % 60
    ).padStart(2, "0")}`;

  renderHudProgress(st, hudRing);
}, 100);

/* ============================================================================ */
/* Helper: card center */
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
/* GALAXY SHUFFLE — LITE */
/* ============================================================================ */

async function runGalaxyShuffle() {
  const duration = 2600;
  const steps = 14;
  const interval = duration / steps;

  for (let i = 0; i < steps; i++) {
    let shuffled = [...POSITIONS].sort(() => Math.random() - 0.5);

    shuffled.forEach((pos, idx) => {
      positionCard(cardRefs[idx].el, pos);
      cardRefs[idx].el.classList.add("card-shuffle");
    });

    await new Promise((res) => setTimeout(res, interval));
  }

  POSITIONS.forEach((pos, idx) => {
    positionCard(cardRefs[idx].el, pos);
    cardRefs[idx].el.classList.remove("card-shuffle");
  });
}

/* ============================================================================ */
/* BOMB ROULETTE — LITE */
/* ============================================================================ */

async function runBombRoulette() {
  const order = [...Array(8).keys(), ...Array(8).keys()];

  for (let idx of order) {
    let el = cardRefs[idx].el;
    el.classList.add("card-glow-red");
    await new Promise((res) => setTimeout(res, 85));
    el.classList.remove("card-glow-red");
  }
}

/* ============================================================================ */
/* MAIN TWIST HANDLER — LITE */
/* ============================================================================ */

arenaTwistStore.subscribe(async (st) => {
  if (!st.active || !st.type) return;

  console.log(
    "%c[TWIST → MESSAGE] Dispatching twist message:",
    "color:#fa0",
    st.payload
  );

  hidePlayerCards();

  document.dispatchEvent(
    new CustomEvent("twist:message", { detail: st.payload })
  );

  FX.clear();
  twistTargetLayer.innerHTML = "";

  if (st.type === "countdown") {
    FX.add(new CountdownFX(st.step));
    setTimeout(() => {
      arenaTwistStore.clear();
      showPlayerCards();
    }, 650);
    return;
  }

  switch (st.type) {
    case "galaxy":
      await runGalaxyShuffle();
      break;

    case "bomb":
      await runBombRoulette();
      break;
  }

  twistOverlay.classList.remove("hidden");
  playTwistAnimation(twistOverlay, st.type, st.title, st.payload);

  await waitForAnimation(twistOverlay);

  clearTwistAnimation(twistOverlay);
  arenaTwistStore.clear();

  showPlayerCards();
});

/* ============================================================================ */
/* GLOBAL TWIST POPUP FALLBACK (ALWAYS WORKS) */
/* ============================================================================ */

if (!window.__bb_twistFallback) {
  window.__bb_twistFallback = true;

  document.addEventListener("twist:message", (ev) => {
    console.log("%c[FALLBACK TWIST] Triggered:", "color:#f0f", ev.detail);

    const hud = document.getElementById("bb-twist-hud");
    const text = document.getElementById("bb-twist-text");

    if (!hud || !text) {
      console.warn("HUD not ready, retry fallback…");
      return setTimeout(() => {
        const h = document.getElementById("bb-twist-hud");
        const t = document.getElementById("bb-twist-text");
        if (h && t) {
          t.textContent = ev.detail?.byDisplayName || "Twist!";
          h.classList.add("show");
          setTimeout(() => h.classList.remove("show"), 2400);
        }
      }, 250);
    }

    text.textContent = ev.detail?.byDisplayName || "Twist!";
    hud.classList.add("show");
    setTimeout(() => hud.classList.remove("show"), 2400);
  });
}

/* ============================================================================ */
/* EXPORT */
/* ============================================================================ */

export default {
  positionCard,
  applyStatus,
};
