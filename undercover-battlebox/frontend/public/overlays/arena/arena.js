// ============================================================================
// arena.js — BattleBox Arena Overlay
// BUILD v12.2 — CENTERED STAGE + BOMB LIFECYCLE SAFE
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
/* SOCKET                                                                       */
/* ============================================================================ */

const socket = getSocket();

/* ============================================================================ */
/* 💣 BOMB STATE — HARD RESETTABLE                                               */
/* ============================================================================ */

let bombSessionId = 0;
let activeBombSession = null;

function resetBombState() {
  activeBombSession = null;
  cardRefs.forEach(ref => {
    ref.el.classList.remove("bomb-scan", "bomb-final-hit");
  });
}

/* ============================================================================ */
/* RUNTIME RESET                                                                */
/* ============================================================================ */

function resetArenaRuntime() {
  resetBombState();
  cardRefs.forEach(ref => {
    ref.el.className = "bb-player-card";
  });
}

socket.on("round:start", resetArenaRuntime);
socket.on("arena:reset", resetArenaRuntime);

/* ============================================================================ */
/* BACKEND ACK                                                                  */
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
const hudRing  = document.getElementById("hud-ring-progress");

const playersContainer = document.getElementById("arena-players");
const twistOverlay     = document.getElementById("twist-takeover");

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
/* WAIT                                                                         */
/* ============================================================================ */

function waitForAnimation(el) {
  return new Promise(resolve => {
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      resolve();
    };
    el.addEventListener("animationend", end, { once: true });
    setTimeout(end, 1500);
  });
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

const RADIUS = 300;

function getArenaCenter() {
  const stage = document.querySelector(".arena-stage");
  if (!stage) return { x: 600, y: 400 };

  const rect = stage.getBoundingClientRect();
  return {
    x: rect.width / 2,
    y: rect.height / 2
  };
}

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
/* RENDER                                                                       */
/* ============================================================================ */

arenaStore.subscribe(state => {
  hudRound.textContent = `RONDE ${state.round}`;
  hudType.textContent  = state.type === "finale" ? "FINALE" : "VOORRONDE";

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
/* STATUS                                                                       */
/* ============================================================================ */

function applyStatus(el, p) {
  el.className = "bb-player-card";

  if (p.eliminated) return el.classList.add("status-elimination");
  if (p.positionStatus === "danger") return el.classList.add("status-danger");

  if (p.positionStatus === "immune") {
    if ((p.breakerHits ?? 0) === 0) return el.classList.add("status-immune-full");
    if ((p.breakerHits ?? 0) === 1) return el.classList.add("status-immune-partial");
  }

  el.classList.add("status-alive");
}

/* ============================================================================ */
/* POSITIONING — 🔥 FIXED CENTER                                                */
/* ============================================================================ */

function positionCard(el, pos) {
  const { x: cx, y: cy } = getArenaCenter();
  const dx = pos.x * RADIUS;
  const dy = pos.y * RADIUS;

  el.style.left = `${cx + dx - 80}px`;
  el.style.top  = `${cy + dy - 80}px`;
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
/* GALAXY                                                                       */
/* ============================================================================ */

function triggerGalaxyEffect() {
  document.body.classList.add("twist-galaxy-blur", "twist-galaxy-spin");
  setTimeout(() => {
    document.body.classList.remove("twist-galaxy-blur", "twist-galaxy-spin");
  }, 2000);
}

/* ============================================================================ */
/* 💣 BOMB                                                                      */
/* ============================================================================ */

async function startBombScan(sessionId) {
  resetBombState();
  activeBombSession = sessionId;

  const cards = cardRefs.map(r => r.el);
  const delay = 100;

  for (let r = 0; r < 3; r++) {
    for (const card of cards) {
      if (activeBombSession !== sessionId) return;
      card.classList.add("bomb-scan");
      await new Promise(res => setTimeout(res, delay));
      card.classList.remove("bomb-scan");
    }
  }
}

function finishBombScan(sessionId, targetIndex) {
  if (activeBombSession !== sessionId) return;
  activeBombSession = null;

  const target = cardRefs[targetIndex]?.el;
  if (!target) return;

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

const trigger = (t, i, d = 900) =>
  setTimeout(() => emitAnimationDone(t, i), d);

function triggerDiamondPistol(id) {
  setTimeout(() => emitAnimationDoneDirect("diamondpistol", id), 900);
}

/* ============================================================================ */
/* GALAXY SHUFFLE                                                               */
/* ============================================================================ */

async function runGalaxyShuffle() {
  for (let i = 0; i < 14; i++) {
    [...POSITIONS].sort(() => Math.random() - 0.5)
      .forEach((p, idx) => positionCard(cardRefs[idx].el, p));
    await new Promise(r => setTimeout(r, 185));
  }
}

/* ============================================================================ */
/* MAIN TWIST LOOP                                                              */
/* ============================================================================ */

arenaTwistStore.subscribe(async st => {
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

  if (st.type === "bomb") {
    if (targetIndex == null) {
      const sid = ++bombSessionId;
      startBombScan(sid);
      st.__bombSessionId = sid;
      return;
    }
    finishBombScan(st.__bombSessionId ?? bombSessionId, targetIndex);
  }

  switch (st.type) {
    case "moneygun": trigger("moneygun", targetIndex); break;
    case "immune":   trigger("immune", targetIndex, 400); break;
    case "heal":     trigger("heal", targetIndex, 400); break;
    case "breaker":  trigger("breaker", targetIndex); break;
    case "diamondpistol":
      triggerDiamondPistol(payload.survivorId);
      break;
  }

  playTwistAnimation(twistOverlay, st.type, st.title, payload);
  await waitForAnimation(twistOverlay);
  clearTwistAnimation(twistOverlay);
  arenaTwistStore.clear();
});

/* ============================================================================ */
export default { positionCard, applyStatus };
