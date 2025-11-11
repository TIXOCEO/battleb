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

export function arenaJoin(
  tiktok_id: string,
  display_name: string,
  username: string,
  source: "queue" | "guest" | "admin" = "queue"
) {
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

export function arenaLeave(tiktok_id: string) {
  const i = arena.players.findIndex((p) => p.id === tiktok_id);
  if (i === -1) return;
  arena.players.splice(i, 1);
  emitArena();
}

export async function arenaClear() {
  for (const p of arena.players)
    await pool.query(
      `UPDATE users SET diamonds_current_round = 0 WHERE tiktok_id = $1`,
      [BigInt(p.id)]
    );
  arena.players = [];
  arena.round = 0;
  arena.type = "quarter";
  arena.isRunning = false;
  emitArena();
}

export async function addDiamondsToArenaPlayer(tid: string, d: number) {
  const p = arena.players.find((p) => p.id === tid);
  if (!p) return;
  p.diamonds += d;
  await addDiamonds(BigInt(tid), d, "current_round");
  emitArena();
}

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

export function emitArena() {
  io.emit("updateArena", getArena());
}

export function initGame() {
  console.log("[5-GAME-ENGINE] Ready");
  emitArena();
}
