// src/engines/5-game-engine.ts
// ARENA ENGINE – spelers in/uit arena, diamonds per ronde

import { io } from "../server";
import pool from "../db";
import { addDiamonds } from "./4-points-engine";

interface Player {
  id: string;
  display_name: string;
  username: string;
  diamonds: number;
  boosters: string[];
  status: "alive" | "eliminated";
  joined_at: number;
}

interface Arena {
  players: Player[];
  round: number;
  type: "quarter" | "semi" | "finale";
  timeLeft: number;
  isRunning: boolean;
  roundStartTime: number;
}

const arena: Arena = {
  players: [],
  round: 0,
  type: "quarter",
  timeLeft: 0,
  isRunning: false,
  roundStartTime: 0,
};

// ── ARENA JOIN ────────────────────────────────────────────────
export function arenaJoin(
  tiktok_id: string,
  display_name: string,
  username: string,
  source: "queue" | "guest" | "admin" = "queue"
): boolean {
  if (arena.players.length >= 8) return false;
  if (arena.players.some((p) => p.id === tiktok_id)) return false;

  const player: Player = {
    id: tiktok_id,
    display_name,
    username,
    diamonds: 0,
    boosters: [],
    status: "alive",
    joined_at: Date.now(),
  };

  arena.players.push(player);
  emitArena();
  return true;
}

// ── ARENA LEAVE ───────────────────────────────────────────────
export function arenaLeave(tiktok_id: string): void {
  const i = arena.players.findIndex((p) => p.id === tiktok_id);
  if (i === -1) return;
  arena.players.splice(i, 1);
  emitArena();
}

// ── ARENA CLEAR ───────────────────────────────────────────────
export async function arenaClear(): Promise<void> {
  for (const p of arena.players) {
    await pool.query(
      `UPDATE users SET diamonds_current_round = 0 WHERE tiktok_id = $1`,
      [BigInt(p.id)]
    );
  }

  arena.players = [];
  arena.round = 0;
  arena.type = "quarter";
  arena.timeLeft = 0;
  arena.isRunning = false;
  arena.roundStartTime = 0;

  emitArena();
}

// ── DIAMONDS VOOR SPELER IN ARENA (VANUIT GIFT-ENGINE) ────────
export async function addDiamondsToArenaPlayer(
  tiktok_id: string,
  diamonds: number
): Promise<void> {
  const p = arena.players.find((p) => p.id === tiktok_id);
  if (!p) return;

  p.diamonds += diamonds;
  await addDiamonds(BigInt(tiktok_id), diamonds, "current_round");
  emitArena();
}

// ── GET ARENA (VOOR API / SOCKET) ─────────────────────────────
export function getArena() {
  return {
    ...arena,
    players: arena.players.map((p) => ({
      id: p.id,
      display_name: p.display_name,
      username: p.username,
      diamonds: p.diamonds,
      boosters: p.boosters,
      status: p.status,
    })),
  };
}

// ── EMIT ARENA NAAR ALLE ADMINS ───────────────────────────────
export function emitArena() {
  io.emit("updateArena", getArena());
}

// ── INIT ──────────────────────────────────────────────────────
export function initGame() {
  console.log("[5-GAME-ENGINE] Ready");
  emitArena();
}
