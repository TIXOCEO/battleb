// ============================================================================
// arena.js — BattleBox Arena Overlay
// BUILD v10.3 — Adds twist:animation-complete backend sync
// Galaxy Blur/Spin + TRUE Bomb Roulette + Immune Logic
// + socket bridge patches
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

// FX imports (existing)
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
import { getSocket } from "/overlays/shared/socket.js";

initEventRouter();

window.addEventListener("DOMContentLoaded", () => {
  initTwistMessage();
});

/* ============================================================================ */
/* SOCKET BRIDGE                                                                 */
/* ============================================================================ */

const socket = getSocket();

socket.on("twist:takeover", (p) => {
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
/* 🔥 PATCH — UNIVERSAL ANIMATION COMPLETE HELPERS                              */
/* ============================================================================ */

function emitAnimationDone(type, targetIndex) {
  const player = arenaStore.get().players[targetIndex];
  if (!player) return;

  socket.emit("twist:animation-complete", {
    type,
    targetId: player.id
  });
}

function emitAnimationDoneDirect(type, targetId) {
  socket.emit("twist:animation-complete", { type, targetId });
}

/* ============================================================================ */
/* DOM refs                                                                     */
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
/* FADE CONTROLS                                                                 */
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
/* POSITIONS                                                                    */
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
/* PLAYER CARDS                                                                 */
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
/* RENDER LOOP                                                                  */
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
/* STATUS LOGIC                                                                  */
/* ============================================================================ */

function resetStatus(el) {
  el.classList.remove(
    "status-alive",
    "status-danger",
    "status-immune-full",
    "status-immune-partial",
    "status-elimination"
  );
}

function applyStatus(el, p) {
  resetStatus(el);

  if (p.eliminated) return el.classList.add("status-elimination");
  if (p.positionStatus === "danger") return el.classList.add("status-danger");

  if (p.positionStatus === "immune") {
    if ((p.breakerHits ?? 0) === 0) return el.classList.add("status-immune-full");
    if ((p.breakerHits ?? 0) > 0) return el.classList.add("status-immune-partial");
  }

  el.classList.add("status-alive");
}

/* ============================================================================ */
/* POSITIONING                                                                   */
/* ============================================================================ */

function positionCard(el, pos) {
  const dx = pos.x * RADIUS;
  const dy = pos.y * RADIUS;

  el.style.left = `${CENTER_X + dx - 80}px`;
  el.style.top = `${CENTER_Y + dy - 80}px`;
}

/* ============================================================================ */
/* TIMER                                                                         */
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
/* EFFECTS — GALAXY + TRUE BOMB ROULETTE                                         */
/* ============================================================================ */

function triggerGalaxyBlurSpin() {
  document.body.classList.add("twist-galaxy-blur");
  document.body.classList.add("twist-galaxy-spin");

  setTimeout(() => {
    document.body.classList.remove("twist-galaxy-blur");
    document.body.classList.remove("twist-galaxy-spin");
  }, 2000);

  // 🔥 Optional: later add animation-complete for galaxy
}

/* ============================================================================ */
/* TRUE BOMB ROULETTE — 🔥 PATCHED WITH ANIMATION COMPLETE                      */
/* ============================================================================ */

async function triggerBombEffects(targetIndex) {
  const total = cardRefs.length;
  const rounds = 4;
  const delay = 120;
  let cur = 0;

  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < total; i++) {
      cardRefs.forEach(ref => ref.el.classList.remove("card-glow-red"));
      cardRefs[cur].el.classList.add("card-glow-red");
      await new Promise(res => setTimeout(res, delay));
      cur = (cur + 1) % total;
    }
  }

  // Final stop
  if (targetIndex != null && cardRefs[targetIndex]) {
    const target = cardRefs[targetIndex].el;

    cardRefs.forEach(ref => ref.el.classList.remove("card-glow-red"));
    target.classList.add("card-glow-red");
    target.classList.add("bomb-hit");

    setTimeout(() => {
      target.classList.remove("bomb-hit");
      target.classList.remove("card-glow-red");

      // 🔥 PATCH — Bomb finished → backend may eliminate
      emitAnimationDone("bomb", targetIndex);

    }, 1500);
  }
}

/* ============================================================================ */
/* Galaxy shuffle                                                                */
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
/* MAIN TWIST HANDLER — 🔥 Patches inserted                                      */
/* ============================================================================ */

arenaTwistStore.subscribe(async (st) => {
  if (!st.active || !st.type) return;

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

  if (st.type === "galaxy") triggerGalaxyBlurSpin();

  if (st.type === "bomb")
    await triggerBombEffects(st.payload?.targetIndex ?? null);

  switch (st.type) {
    case "galaxy":
      await runGalaxyShuffle();
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
/* twist:message (fallback popups & extra triggers)                                */
/* ============================================================================ */

document.addEventListener("twist:message", async (ev) => {
  const t = ev.detail;
  if (!t || !t.type) return;

  if (t.type === "galaxy") triggerGalaxyBlurSpin();
  if (t.type === "bomb") await triggerBombEffects(t.targetIndex ?? null);
});

/* ============================================================================ */
/* FALLBACK POPUP                                                                */
/* ============================================================================ */

if (!window.__bb_twistFallback) {
  window.__bb_twistFallback = true;

  document.addEventListener("twist:message", (ev) => {
    const hud = document.getElementById("bb-twist-hud");
    const text = document.getElementById("bb-twist-text");

    if (!hud || !text) return;

    text.textContent = ev.detail?.byDisplayName || "Twist!";
    hud.classList.add("show");

    setTimeout(() => hud.classList.remove("show"), 2400);
  });
}

/* ============================================================================ */
export default { positionCard, applyStatus };
