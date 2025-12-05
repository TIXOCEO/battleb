// ============================================================================
// arena-router.js — Event Router for Arena Overlay (OBS)
// ============================================================================

import { arenaStore } from "./arena-store.js";
import { socket } from "./socket.js";

// ---------------------------------------------------------------------------
// Handle full arena update
// ---------------------------------------------------------------------------
socket.on("updateArena", (payload) => {
  if (!payload) return;

  // HUD update
  if (payload.hud) {
    arenaStore.setHUD({
      roundNumber: payload.hud.roundNumber,
      roundType: payload.hud.roundType,
      roundStatus: payload.hud.roundStatus,
      remainingMs: payload.hud.remainingMs,
      totalMs: payload.hud.totalMs,
    });
  }

  // Player update
  if (payload.players) {
    arenaStore.setPlayers(payload.players);
  }
});

// ---------------------------------------------------------------------------
// INITIAL SNAPSHOT (bij connect overlay)
// ---------------------------------------------------------------------------
socket.on("overlayInitialSnapshot", (snap) => {
  if (!snap?.arena) return;

  const arena = snap.arena;

  // HUD vullen
  arenaStore.setHUD({
    roundNumber: arena.round || 0,
    roundType: arena.type || "quarter",
    roundStatus: arena.status || "idle",
    remainingMs: 0,
    totalMs: 0,
  });

  // players vullen
  if (arena.players) {
    arenaStore.setPlayers(
      arena.players.map((p) => ({
        id: p.id,
        display_name: p.display_name,
        username: p.username,
        avatar_url: p.avatar_url || null,
        positionStatus: p.positionStatus || "alive",
        score: p.score || 0,
        breakerHits: p.breakerHits || 0,
      }))
    );
  }
});

// ---------------------------------------------------------------------------
// ROUND EVENTS — update alleen HUD status
// ---------------------------------------------------------------------------
socket.on("round:start", (data) => {
  arenaStore.setHUD({
    roundNumber: data.round,
    roundType: data.type,
    roundStatus: "active",
    remainingMs: data.duration * 1000,
    totalMs: data.duration * 1000,
  });
});

socket.on("round:grace", (data) => {
  arenaStore.setHUD({
    roundNumber: data.round,
    roundType: "quarter",
    roundStatus: "grace",
    remainingMs: data.grace * 1000,
    totalMs: data.grace * 1000,
  });
});

socket.on("round:end", (data) => {
  arenaStore.setHUD({
    roundNumber: data.round,
    roundType: data.type,
    roundStatus: "ended",
    remainingMs: 0,
    totalMs: 0,
  });
});
