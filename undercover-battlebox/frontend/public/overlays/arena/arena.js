// ============================================================================
// arena.js — BattleBox Arena Overlay
// BUILD v12.3 — Bomb FAST-SCAN (Beamless Final + Duplicate-Null Fix)
//
// FIXES ADDED IN THIS PATCH:
// ✔ Extra null-target events worden genegeerd (nooit 2e scan!)
// ✔ bombScanStarted voorkomt dubbele start
// ✔ resetArenaRuntime reset nu ook bombScanStarted
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
/* SOCKET + RESET                                                                */
/* ============================================================================ */

const socket = getSocket();

// BOMB Flags — final model
let bombScanActive = false;
let bombResolveHit = null;

// ⭐ NEW FLAG — prevents duplicate null-target scans
let bombScanStarted = false;

/** FULL reset only at round or arena reset */
function resetArenaRuntime() {
  console.warn("[ARENA RESET] Runtime flags cleared");

  bombScanActive = false;
  bombResolveHit = null;

  // ⭐ RESET OUR NEW FLAG
  bombScanStarted = false;

  cardRefs.forEach(ref => {
    ref.el.classList.remove(
      "bomb-scan",
      "bomb-final-hit",
      "status-elimination",
      "status-danger",
      "status-immune-full",
      "status-immune-partial",
      "status-alive"
    );
    ref.el.className = "bb-player-card";
  });
}

// Twist events DO NOT reset → prevents bomb breaking
socket.on("twist:takeover", (p) => {
  document.dispatchEvent(new CustomEvent("twist:message", {
    detail: {
      type: p.type || "",
      byDisplayName: p.by || p.byDisplayName || "Onbekend",
      target: p.targetName || null,
      victims: p.victimNames || [],
      survivor: p.survivorName || null,
      targetIndex: p.targetIndex ?? null
    }
  }));

  arenaTwistStore.activate({
    type: p.type,
    title: p.title,
    payload: p
  });
});

socket.on("round:start", () => resetArenaRuntime());
socket.on("arena:reset", () => resetArenaRuntime());

socket.on("twist:clear", () => {
  document.dispatchEvent(new Event("twist:clear"));
});

/* ============================================================================ */
/* ANIMATION COMPLETE → BACKEND                                                  */
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
/* DOM REFS & CARD CREATION                                                      */
/* ============================================================================ */

const root = document.getElementById("arena-root");
const hudRound = document.getElementById("hud-round");
const hudType = document.getElementById("hud-type");
const hudTimer = document.getElementById("hud-timer");
const hudRing = document.getElementById("hud-ring-progress");
const playersContainer = document.getElementById("arena-players");
const twistOverlay = document.getElementById("twist-takeover");

const EMPTY_AVATAR = "https://i.imgur.com/x6v5tkX.jpeg";

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
/* RENDER LOOP                                                                    */
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
  if (p.positionStatus === "danger") return el.classList.add("status-danger");

  if (p.positionStatus === "immune") {
    if ((p.breakerHits ?? 0) === 0) return el.classList.add("status-immune-full");
    if ((p.breakerHits ?? 0) === 1) return el.classList.add("status-immune-partial");
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
/* BOMB — FINAL BEAMLESS FAST-SCAN ENGINE                                        */
/* ============================================================================ */

async function startBombScan() {
  console.log("[BOMB] Scan STARTED");

  bombScanActive = true;
  bombResolveHit = null;

  const cards = cardRefs.map(ref => ref.el);
  const delay = 100;
  const rounds = 3;

  const waitForHit = new Promise(resolve => {
    bombResolveHit = resolve;
  });

  async function scanLoop() {
    for (let r = 0; r < rounds; r++) {
      for (let i = 0; i < cards.length; i++) {
        if (!bombScanActive) return;

        cards[i].classList.add("bomb-scan");
        await new Promise(res => setTimeout(res, delay));
        cards[i].classList.remove("bomb-scan");
      }
    }
  }

  await Promise.race([
    scanLoop(),
    waitForHit
  ]);

  console.log("[BOMB] Scan COMPLETE (either natural or interrupted)");
}

async function finishBombScan(targetIndex) {
  console.log("[BOMB] Target EVENT received:", targetIndex);

  if (!bombScanActive && !bombResolveHit) {
    console.warn("[BOMB] Target ignored — no active scan");
    return;
  }

  bombScanActive = false;
  bombResolveHit?.();

  const target = cardRefs[targetIndex]?.el;
  if (!target) return;

  target.classList.add("bomb-final-hit");

  setTimeout(() => {
    target.classList.remove("bomb-final-hit");
    target.classList.add("status-elimination");

    emitAnimationDone("bomb", targetIndex);

    bombResolveHit = null;
    bombScanActive = false;
  }, 900);
}

/* ============================================================================ */
/* MAIN TWIST ENGINE WITH PATCHED BOMB CASE                                      */
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

      // ⭐ FIX: Prevent duplicate null-target scans
      if (targetIndex == null) {

        if (bombScanStarted) {
          console.log("[BOMB] Duplicate null event ignored");
          break;
        }

        bombScanStarted = true;

        if (!bombScanActive) startBombScan();
        break;
      }

      // Target event → finish scan
      finishBombScan(targetIndex);
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
