// ============================================================================
// arena.js — BattleBox Arena Overlay
// BUILD v12.0 — Bomb FAST-SCAN Fixed + No Runtime Reset on Event 1
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
import CountdownFX from "/overlays/shared/fx/CountdownFX.js";

import { initTwistMessage } from "/overlays/arena/twistMessage.js";
import { getSocket } from "/overlays/shared/socket.js";

initEventRouter();

window.addEventListener("DOMContentLoaded", () => {
  initTwistMessage();
});

/* ============================================================================ */
/* SOCKET + RUNTIME RESET                                                       */
/* ============================================================================ */

const socket = getSocket();

// Bomb event flags
let bombScanActive = false;
let bombScanStopRequested = false;

// RESET ONLY ON ROUND or FULL ARENA RESET
function resetArenaRuntime() {
  console.warn("[ARENA RESET] Runtime flags cleared");

  bombScanActive = false;
  bombScanStopRequested = false;

  cardRefs.forEach(ref => {
    ref.el.classList.remove(
      "bomb-scan",
      "bomb-final-hit",
      "card-shuffle",
      "status-elimination",
      "status-danger",
      "status-immune-full",
      "status-immune-partial",
      "status-alive"
    );
    ref.el.className = "bb-player-card";
  });
}

// ✅ ONLY valid reset triggers
socket.on("round:start", () => {
  console.warn("[ARENA] round:start → runtime reset");
  resetArenaRuntime();
});

socket.on("arena:reset", () => {
  console.warn("[ARENA] arena:reset → runtime reset");
  resetArenaRuntime();
});

/* ============================================================================ */
/* ANIMATION COMPLETE → backend                                                 */
/* ============================================================================ */

function emitAnimationDone(type, targetIndex) {
  const player = arenaStore.get().players[targetIndex];
  if (!player) return;
  socket.emit("twist:animation-complete", { type, targetId: player.id });
}

function emitAnimationDoneDirect(type, targetId) {
  socket.emit("twist:animation-complete", { type, targetId });
}

/* ============================================================================ */
/* DOM REFS                                                                     */
/* ============================================================================ */

const hudRound = document.getElementById("hud-round");
const hudType = document.getElementById("hud-type");
const hudTimer = document.getElementById("hud-timer");
const hudRing = document.getElementById("hud-ring-progress");
const playersContainer = document.getElementById("arena-players");
const twistOverlay = document.getElementById("twist-takeover");

const EMPTY_AVATAR = "https://i.imgur.com/x6v5tkX.jpeg";

/* ============================================================================ */
/* FADE                                                                         */
/* ============================================================================ */

function fadeOutCards() { playersContainer.classList.add("fade-out"); }
function fadeInCards() {
  playersContainer.classList.remove("fade-out");
  playersContainer.classList.add("fade-in");
  setTimeout(() => playersContainer.classList.remove("fade-in"), 450);
}

/* ============================================================================ */
/* waitForAnimation                                                             */
/* ============================================================================ */

function waitForAnimation(el) {
  return new Promise((resolve) => {
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      el.removeEventListener("animationend", end);
      resolve();
    };
    el.addEventListener("animationend", end, { once: true });
    setTimeout(end, 1500);
  });
}

/* ============================================================================ */
/* POSITIONS / CARDS                                                            */
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

  for (let i = 0; i < 8; i++) {
    const ref = cardRefs[i];
    const p = state.players[i];

    if (!p) {
      ref.name.textContent = "LEEG";
      ref.score.textContent = "0";
      ref.bg.style.backgroundImage = `url(${EMPTY_AVATAR})`;
      ref.el.className = "bb-player-card";
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
/* STATUS LOGIC                                                                 */
/* ============================================================================ */

function applyStatus(el, p) {
  el.className = "bb-player-card";

  if (p.eliminated) return el.classList.add("status-elimination");
  if (p.positionStatus === "danger") return el.classList.add("status-danger");

  if (p.positionStatus === "immune") {
    if ((p.breakerHits ?? 0) === 0)
      return el.classList.add("status-immune-full");
    if ((p.breakerHits ?? 0) === 1)
      return el.classList.add("status-immune-partial");
  }

  el.classList.add("status-alive");
}

/* ============================================================================ */
/* POSITIONING                                                                  */
/* ============================================================================ */

function positionCard(el, pos) {
  const dx = pos.x * RADIUS;
  const dy = pos.y * RADIUS;
  el.style.left = `${CENTER_X + dx - 80}px`;
  el.style.top = `${CENTER_Y + dy - 80}px`;
}

/* ============================================================================ */
/* TIMER                                                                        */
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
/* GALAXY EFFECT                                                                */
/* ============================================================================ */

function triggerGalaxyEffect() {
  document.body.classList.add("twist-galaxy-blur", "twist-galaxy-spin");
  setTimeout(() => {
    document.body.classList.remove("twist-galaxy-blur", "twist-galaxy-spin");
  }, 2000);
}

/* ============================================================================ */
/* BOMB — FAST SCAN (DUAL PHASE)                                                */
/* ============================================================================ */

async function startBombScan() {
  if (bombScanActive) return;

  bombScanActive = true;
  bombScanStopRequested = false;

  const cards = cardRefs.map(ref => ref.el);
  const delay = 100;
  const rounds = 3;

  console.log("[BOMB] Scan STARTED");

  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < cards.length; i++) {
      if (bombScanStopRequested) return;
      cards[i].classList.add("bomb-scan");
      await new Promise(res => setTimeout(res, delay));
      cards[i].classList.remove("bomb-scan");
    }
  }

  console.log("[BOMB] Scan finished → waiting on target...");
}

function finishBombScan(targetIndex) {
  bombScanStopRequested = true;
  bombScanActive = false;

  const target = cardRefs[targetIndex]?.el;
  if (!target) return;

  console.log("[BOMB] Target HIT:", targetIndex);

  target.classList.add("bomb-final-hit");

  setTimeout(() => {
    target.classList.remove("bomb-final-hit");
    target.classList.add("status-elimination");
    emitAnimationDone("bomb", targetIndex);
  }, 900);
}

/* ============================================================================ */
/* SIMPLE TWISTS                                                                */
/* ============================================================================ */

function triggerMoneyGun(targetIndex) {
  setTimeout(() => emitAnimationDone("moneygun", targetIndex), 900);
}

function triggerBreaker(targetIndex) {
  setTimeout(() => emitAnimationDone("breaker", targetIndex), 900);
}

function triggerImmune(targetIndex) {
  // immune heeft geen animatie → backend moet toch vrijgegeven worden
  setTimeout(() => {
    if (targetIndex != null) {
      emitAnimationDone("immune", targetIndex);
    } else {
      socket.emit("twist:animation-complete", { type: "immune" });
    }
  }, 400);
}

function triggerHeal(targetIndex) {
  // heal idem → altijd animation-complete sturen
  setTimeout(() => {
    if (targetIndex != null) {
      emitAnimationDone("heal", targetIndex);
    } else {
      socket.emit("twist:animation-complete", { type: "heal" });
    }
  }, 400);
}

function triggerDiamondPistol(survivorId, targetIndex) {
  if (survivorId)
    return setTimeout(
      () => emitAnimationDoneDirect("diamondpistol", survivorId),
      900
    );

  const p = arenaStore.get().players[targetIndex];
  if (p)
    setTimeout(
      () => emitAnimationDoneDirect("diamondpistol", p.id),
      900
    );
}

/* ============================================================================ */
/* GALAXY SHUFFLE                                                               */
/* ============================================================================ */

async function runGalaxyShuffle() {
  const steps = 14;
  const interval = 2600 / steps;

  for (let i = 0; i < steps; i++) {
    const shuffled = [...POSITIONS].sort(() => Math.random() - 0.5);

    shuffled.forEach((pos, idx) => {
      positionCard(cardRefs[idx].el, pos);
      cardRefs[idx].el.classList.add("card-shuffle");
    });

    await new Promise(r => setTimeout(r, interval));
  }

  POSITIONS.forEach((pos, idx) => {
    positionCard(cardRefs[idx].el, pos);
    cardRefs[idx].el.classList.remove("card-shuffle");
  });
}

/* ============================================================================ */
/* MAIN TWIST ENGINE                                                            */
/* ============================================================================ */

arenaTwistStore.subscribe(async (st) => {
  if (!st.active || !st.type) return;

  const payload = st.payload || {};
  const targetIndex = payload.targetIndex ?? null;

  FX.clear();
  fadeInCards();

  if (st.type === "galaxy") {
    triggerGalaxyEffect();
    await runGalaxyShuffle();
    arenaTwistStore.clear();
    return;
  }

  if (st.type === "countdown") {
    fadeOutCards();
    FX.add(new CountdownFX(st.step));
    setTimeout(() => {
      arenaTwistStore.clear();
      fadeInCards();
    }, 650);
    return;
  }

  switch (st.type) {
  case "bomb":
    if (targetIndex == null) startBombScan();
    else finishBombScan(targetIndex);
    break;

  case "moneygun":
    triggerMoneyGun(targetIndex);
    break;

  case "immune":
    triggerImmune(targetIndex);
    break;

  case "heal":
    triggerHeal(targetIndex);
    break;

  case "breaker":
    triggerBreaker(targetIndex);
    break;

  case "diamondpistol":
    triggerDiamondPistol(payload.survivorId, targetIndex);
    break;
}
  
  twistOverlay.classList.remove("hidden");
  playTwistAnimation(twistOverlay, st.type, st.title, payload);

  await waitForAnimation(twistOverlay);

  clearTwistAnimation(twistOverlay);
  arenaTwistStore.clear();
});

/* ============================================================================ */
export default { positionCard, applyStatus };
