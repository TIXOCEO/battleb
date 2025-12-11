// ============================================================================
// arena.js — BattleBox Arena Overlay
// BUILD v10.0 — GALAXY SPIN/BLUR + BOMB ROULETTE + IMMUNE LOGIC
// + DEBUG LOGGING FOR TWIST MESSAGE PAYLOADS
// + SOCKET BRIDGE PATCH (twist:takeover → twist:message)
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

// FX imports (unused but kept)
import MoneyGunFX from "/overlays/shared/fx/MoneyGunFX.js";
import DiamondBlastFX from "/overlays/shared/fx/DiamondBlastFX.js";
import BombFX from "/overlays/shared/fx/BombFX.js";
import CountdownFX from "/overlays/shared/fx/CountdownFX.js";
import TargetPulseFX from "/overlays/shared/fx/TargetPulseFX.js";
import VictimBlastFX from "/overlays/shared/fx/VictimBlastFX.js";
import SurvivorShieldFX from "/overlays/shared/fx/SurvivorShieldFX.js";
import GalaxyFX from "/overlays/shared/fx/GalaxyFX.js";
import BeamFX from "/overlays/shared/fx/BeamFX.js";

import { initTwistMessage } from "/overlays/arena/twistMessage.js";

// ⭐ SOCKET BRIDGE
import { getSocket } from "/overlays/shared/socket.js";

initEventRouter();

window.addEventListener("DOMContentLoaded", () => {
  initTwistMessage();
});

/* ============================================================================ */
/* SOCKET BRIDGE: twist → DOM                                                  */
/* ============================================================================ */
const socket = getSocket();

socket.on("twist:takeover", (p) => {
  console.log("%c[BRIDGE] twist:takeover → twist:message", "color:#0f0", p);

  document.dispatchEvent(
    new CustomEvent("twist:message", {
      detail: {
        type: p.type || "",
        byDisplayName: p.by || p.byDisplayName || "Onbekend",
        target: p.targetName || null,
        victims: p.victimNames || [],
        survivor: p.survivorName || null,
        targetIndex: p.targetIndex ?? null
      }
    })
  );
});

socket.on("twist:clear", () => {
  document.dispatchEvent(new Event("twist:clear"));
});

/* ============================================================================ */
/* DOM references */
/* ============================================================================ */

const root = document.getElementById("arena-root");
const hudRound = document.getElementById("hud-round");
const hudType = document.getElementById("hud-type");
const hudTimer = document.getElementById("hud-timer");
const hudRing = document.getElementById("hud-ring-progress");
const playersContainer = document.getElementById("arena-players");
const twistOverlay = document.getElementById("twist-takeover");

let bombRoulette = document.getElementById("bomb-roulette");
if (!bombRoulette) {
  bombRoulette = document.createElement("div");
  bombRoulette.id = "bomb-roulette";
  root.appendChild(bombRoulette);
}

const twistTargetLayer =
  document.getElementById("twist-target") || document.createElement("div");

const EMPTY_AVATAR = "https://i.imgur.com/x6v5tkX.jpeg";

/* ============================================================================ */
/* Fade playercards */
/* ============================================================================ */

function hidePlayerCards() {
  playersContainer.classList.add("fade-out");
}

function showPlayerCards() {
  playersContainer.classList.remove("fade-out");
  playersContainer.classList.add("fade-in");
  setTimeout(() => playersContainer.classList.remove("fade-in"), 450);
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
/* Animation helpers */
/* ============================================================================ */

function waitForAnimation(el) {
  return new Promise((resolve) => {
    let t = setTimeout(resolve, 600);
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
/* Playercards */
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
  hudType.textContent = state.type === "finale" ? "FINALE" : "VOORRONDE";

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
/* Status logic */
/* ============================================================================ */

function resetStatus(el) {
  el.classList.remove(
    "status-alive",
    "status-danger",
    "status-immune",
    "status-immune-broken",
    "status-elimination",
    "status-immune-full",
    "status-immune-partial"
  );
}

function applyStatus(el, p) {
  resetStatus(el);

  if (p.eliminated) return el.classList.add("status-elimination");

  if (p.positionStatus === "danger") return el.classList.add("status-danger");

  if (p.positionStatus === "immune") {
    if ((p.breakerHits ?? 0) === 0) {
      return el.classList.add("status-immune-full");
    }
    if ((p.breakerHits ?? 0) > 0) {
      return el.classList.add("status-immune-partial");
    }
  }

  el.classList.add("status-alive");
}

/* ============================================================================ */
/* Position cards */
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
    `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

  renderHudProgress(st, hudRing);
}, 100);

/* ============================================================================ */
/* GALAXY BLUR + SPIN */
/* ============================================================================ */

function triggerGalaxyBlurSpin() {
  document.body.classList.add("twist-galaxy-blur");
  document.body.classList.add("twist-galaxy-spin");

  setTimeout(() => {
    document.body.classList.remove("twist-galaxy-blur");
    document.body.classList.remove("twist-galaxy-spin");
  }, 2000);
}

/* ============================================================================ */
/* BOMB ROULETTE + TARGET HIT */
/* ============================================================================ */

function triggerBombEffects(targetIndex) {
  bombRoulette.classList.add("active");

  setTimeout(() => {
    bombRoulette.classList.remove("active");

    if (targetIndex != null && cardRefs[targetIndex]) {
      const card = cardRefs[targetIndex].el;
      card.classList.add("bomb-hit");
      setTimeout(() => card.classList.remove("bomb-hit"), 1500);
    }
  }, 2000);
}

/* ============================================================================ */
/* Galaxy shuffle (existing lite mode) */
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
/* Bomb roulette (existing lite mode) */
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
/* MAIN TWIST HANDLER */
/* ============================================================================ */

arenaTwistStore.subscribe(async (st) => {
  if (!st.active || !st.type) return;

  console.log("%c[TWIST MESSAGE]", "color:#fa0", st.payload);

  hidePlayerCards();

  document.dispatchEvent(new CustomEvent("twist:message", { detail: st.payload }));

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

  // SIMPLE TRIGGERS
  if (st.type === "galaxy") triggerGalaxyBlurSpin();
  if (st.type === "bomb") triggerBombEffects(st.payload?.targetIndex ?? null);

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
/* TWIST POPUP FALLBACK */
/* ============================================================================ */

if (!window.__bb_twistFallback) {
  window.__bb_twistFallback = true;

  document.addEventListener("twist:message", (ev) => {
    console.log("%c[FALLBACK TWIST]", "color:#f0f", ev.detail);

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
export default { positionCard, applyStatus };
