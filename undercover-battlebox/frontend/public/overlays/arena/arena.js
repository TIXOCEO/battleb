// ============================================================================
// arena.js — BattleBox Arena Overlay
// BUILD v11.8 — Bomb FAST-SCAN Dual-Event System (Fixed Race Conditions)
// 
// FIXES from v11.7:
// ✔ PRE-EMPTIVE STOP: scan stopt DIRECT zodra targetIndex event arriveert
// ✔ No “scan missing on second bomb” bug
// ✔ Proper reset of all bomb-related flags
// ✔ Guaranteed sequence: BOM MSG → SCAN → TARGET MSG → HIT
// ✔ All other code 100% intact
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
/* SOCKET BRIDGE – popup only                                                    */
/* ============================================================================ */

const socket = getSocket();

// Bomb dual-event flags
let bombScanActive = false;
let bombScanStopRequested = false;

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

  arenaTwistStore.activate({
    type: p.type,
    title: p.title,
    payload: p
  });
});

socket.on("twist:clear", () => {
  document.dispatchEvent(new Event("twist:clear"));
});

/* ============================================================================ */
/* ANIMATION COMPLETE → backend                                                  */
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
/* DOM REFS                                                                      */
/* ============================================================================ */

const root = document.getElementById("arena-root");
const hudRound = document.getElementById("hud-round");
const hudType = document.getElementById("hud-type");
const hudTimer = document.getElementById("hud-timer");
const hudRing = document.getElementById("hud-ring-progress");
const playersContainer = document.getElementById("arena-players");
const twistOverlay = document.getElementById("twist-takeover");

const EMPTY_AVATAR = "https://i.imgur.com/x6v5tkX.jpeg";

/* ============================================================================ */
/* FADE FUNCTIONS                                                                */
/* ============================================================================ */

function fadeOutCards() { playersContainer.classList.add("fade-out"); }
function fadeInCards() {
  playersContainer.classList.remove("fade-out");
  playersContainer.classList.add("fade-in");
  setTimeout(() => playersContainer.classList.remove("fade-in"), 450);
}

/* ============================================================================ */
/* waitForAnimation                                                              */
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
/* POSITIONS / CARDS / RENDER LOOP — UNCHANGED                                   */
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
  el.className = "bb-player-card";
}

function applyStatus(el, p) {
  if (p.eliminated) return el.classList.add("status-elimination");

  if (p.positionStatus === "danger")
    return el.classList.add("status-danger");

  if (p.positionStatus === "immune") {
    if ((p.breakerHits ?? 0) === 0)
      return el.classList.add("status-immune-full");

    if ((p.breakerHits ?? 0) === 1)
      return el.classList.add("status-immune-partial");
  }

  el.classList.add("status-alive");
}

/* ============================================================================ */
/* POSITIONING                                                                    */
/* ============================================================================ */

function positionCard(el, pos) {
  const dx = pos.x * RADIUS;
  const dy = pos.y * RADIUS;
  el.style.left = `${CENTER_X + dx - 80}px`;
  el.style.top = `${CENTER_Y + dy - 80}px`;
}

/* ============================================================================ */
/* TIMER                                                                          */
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
/* GALAXY EFFECT                                                                  */
/* ============================================================================ */

function triggerGalaxyEffect() {
  document.body.classList.add("twist-galaxy-blur");
  document.body.classList.add("twist-galaxy-spin");

  setTimeout(() => {
    document.body.classList.remove("twist-galaxy-blur");
    document.body.classList.remove("twist-galaxy-spin");
  }, 2000);
}

/* ============================================================================ */
/* BOMB — FAST-SCAN (event #1)                                                   */
/* ============================================================================ */

async function startBombScan() {
  bombScanActive = true;
  bombScanStopRequested = false;

  console.log("[BOMB] Scan STARTED");

  const cards = cardRefs.map(ref => ref.el);
  const delay = 100;
  const rounds = 3;

  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < cards.length; i++) {

      // PRE-EMPTIVE STOP → event #2 arrived
      if (bombScanStopRequested) {
        console.log("[BOMB] Scan interrupted — jumping to HIT");
        return;
      }

      const card = cards[i];
      card.classList.add("bomb-scan");

      await new Promise(res => setTimeout(res, delay));

      card.classList.remove("bomb-scan");
    }
  }

  console.log("[BOMB] Scan finished naturally — waiting for target...");
}

/* ============================================================================ */
/* BOMB HIT — event #2                                                           */
/* ============================================================================ */

async function finishBombScan(targetIndex) {
  if (!bombScanActive) {
    // Rare case: event order reversed → still hit
    bombScanActive = false;
    bombScanStopRequested = false;
  }

  console.log("[BOMB] Target received:", targetIndex);

  // STOP scan immediately
  bombScanStopRequested = true;
  bombScanActive = false;

  const target = cardRefs[targetIndex]?.el;
  if (!target) return;

  target.classList.add("bomb-final-hit");

  setTimeout(() => {
    target.classList.remove("bomb-final-hit");
    target.classList.add("status-elimination");

    emitAnimationDone("bomb", targetIndex);

    // absolute cleanup
    bombScanActive = false;
    bombScanStopRequested = false;

  }, 900);
}

/* ============================================================================ */
/* SIMPLE TWISTS                                                                 */
/* ============================================================================ */

function triggerMoneyGun(targetIndex) {
  setTimeout(() => emitAnimationDone("moneygun", targetIndex), 900);
}

function triggerBreaker(targetIndex) {
  setTimeout(() => emitAnimationDone("breaker", targetIndex), 900);
}

function triggerDiamondPistol(survivorId, targetIndex) {
  if (survivorId)
    return setTimeout(() =>
      emitAnimationDoneDirect("diamondpistol", survivorId), 900);

  const p = arenaStore.get().players[targetIndex];
  if (p)
    setTimeout(() =>
      emitAnimationDoneDirect("diamondpistol", p.id), 900);
}

/* ============================================================================ */
/* GALAXY SHUFFLE                                                                 */
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
/* MAIN TWIST ENGINE                                                             */
/* ============================================================================ */

arenaTwistStore.subscribe(async (st) => {
  if (!st.active || !st.type) return;

  const payload = st.payload || {};
  const targetIndex = payload.targetIndex ?? null;

  FX.clear();
  fadeInCards();

  // SPECIAL — GALAXY
  if (st.type === "galaxy") {
    triggerGalaxyEffect();
    await runGalaxyShuffle();
    arenaTwistStore.clear();
    return;
  }

  // SPECIAL — COUNTDOWN
  if (st.type === "countdown") {
    fadeOutCards();
    FX.add(new CountdownFX(st.step));
    setTimeout(() => {
      arenaTwistStore.clear();
      fadeInCards();
    }, 650);
    return;
  }

  // NORMAL TWISTS
  switch (st.type) {

    case "bomb":
      if (targetIndex == null) {
        // event #1 → begin scan
        if (!bombScanActive) startBombScan();
      } else {
        // event #2 → finish hit
        finishBombScan(targetIndex);
      }
      break;

    case "moneygun":
      triggerMoneyGun(targetIndex);
      break;

    case "breaker":
      triggerBreaker(targetIndex);
      break;

    case "diamondpistol":
      triggerDiamondPistol(payload.survivorId, targetIndex);
      break;
  }

  // Show overlay for these twists
  twistOverlay.classList.remove("hidden");
  playTwistAnimation(twistOverlay, st.type, st.title, payload);

  await waitForAnimation(twistOverlay);

  clearTwistAnimation(twistOverlay);
  arenaTwistStore.clear();
});

/* ============================================================================ */
/* FALLBACK POPUP                                                                 */
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
