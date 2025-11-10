// src/engines/5-game-engine.ts — FINAL VERSION – NOVEMBER 2025
import { io } from '../server';
import pool from '../db';
import { addDiamonds } from './4-points-engine';

interface Player {
  id: string;
  display_name: string;
  username: string;
  diamonds: number;
  boosters: string[];
  status: 'alive' | 'eliminated';
  joined_at: number;
}

interface Arena {
  players: Player[];
  round: number;
  type: 'quarter' | 'semi' | 'finale';
  timeLeft: number;
  isRunning: boolean;
  roundStartTime: number;
}

const arena: Arena = {
  players: [],
  round: 0,
  type: 'quarter',
  timeLeft: 0,
  isRunning: false,
  roundStartTime: 0
};

const ROUND_TIMES = {
  quarter: 180,
  semi: 240,
  finale: 300
};

// ── ARENA: JOIN ─────────────────────────────────────────────────────
export function arenaJoin(
  tiktok_id: string,
  display_name: string,
  username: string,
  source: 'queue' | 'guest' | 'admin' = 'queue'
): boolean {
  if (arena.players.length >= 8) return false;
  if (arena.players.some(p => p.id === tiktok_id)) return false;

  const player: Player = {
    id: tiktok_id,
    display_name,
    username,
    diamonds: 0,
    boosters: [],
    status: 'alive',
    joined_at: Date.now()
  };

  arena.players.push(player);
  console.log(`[ARENA JOIN] ${display_name} (@${username}) → slot ${arena.players.length}/8`);
  emitArena();
  return true;
}

// ── ARENA: LEAVE ────────────────────────────────────────────────────
export function arenaLeave(tiktok_id: string): void {
  const index = arena.players.findIndex(p => p.id === tiktok_id);
  if (index === -1) return;

  const player = arena.players[index];
  console.log(`[ARENA LEAVE] ${player.display_name} (@${player.username})`);
  arena.players.splice(index, 1);
  emitArena();
}

// ── ARENA: CLEAR ────────────────────────────────────────────────────
export async function arenaClear(): Promise<void> {
  console.log('[ARENA] Geleegd voor nieuwe ronde');

  // Reset current_round diamonds voor alle spelers
  for (const p of arena.players) {
    await pool.query(
      `UPDATE users SET diamonds_current_round = 0 WHERE tiktok_id = $1`,
      [BigInt(p.id)]
    );
  }

  arena.players = [];
  arena.round = 0;
  arena.type = 'quarter';
  arena.timeLeft = 0;
  arena.isRunning = false;
  arena.roundStartTime = 0;

  emitArena();
}

// ── DIAMONDS TOEVOEGEN (vanuit gift-engine) ─────────────────────────
export async function addDiamondsToArenaPlayer(tiktok_id: string, diamonds: number): Promise<void> {
  const player = arena.players.find(p => p.id === tiktok_id);
  if (!player) return;

  player.diamonds += diamonds;
  await addDiamonds(BigInt(tiktok_id), diamonds, 'current_round');
  emitArena();
}

// ── START RONDE ─────────────────────────────────────────────────────
export function startRound(type: 'quarter' | 'semi' | 'finale'): boolean {
  if (arena.isRunning) {
    console.log('[RONDE] Kan niet starten – er loopt al een ronde!');
    return false;
  }

  if (arena.players.length < 2) {
    console.log('[RONDE] Niet genoeg spelers! Minimaal 2 nodig.');
    return false;
  }

  arena.round += 1;
  arena.type = type;
  arena.timeLeft = ROUND_TIMES[type];
  arena.isRunning = true;
  arena.roundStartTime = Date.now();

  console.log(`\nRONDE ${arena.round} GESTART – ${type.toUpperCase()} – ${arena.timeLeft}s`);
  console.log(`Spelers: ${arena.players.map(p => p.display_name).join(', ')}`);
  emitArena();

  const timer = setInterval(() => {
    arena.timeLeft -= 1;
    emitArena();

    if (arena.timeLeft <= 0) {
      clearInterval(timer);
      endRound();
    }
  }, 1000);

  return true;
}

// ── EINDE RONDE ─────────────────────────────────────────────────────
function endRound(): void {
  arena.isRunning = false;

  const winner = getWinner();
  console.log(`\nRONDE ${arena.round} EINDE`);
  console.log(`WINNAAR: ${winner?.display_name || 'Niemand'} (${winner?.diamonds || 0} diamonds)`);

  const sorted = [...arena.players].sort((a, b) => b.diamonds - a.diamonds);
  sorted.slice(0, 3).forEach((p, i) => {
    console.log(`${i + 1}ᵉ: ${p.display_name} – ${p.diamonds} diamonds`);
  });

  // Stuur naar frontend
  io.emit('roundEnd', {
    round: arena.round,
    type: arena.type,
    winner: winner ? {
      id: winner.id,
      display_name: winner.display_name,
      username: winner.username,
      diamonds: winner.diamonds
    } : null,
    top3: sorted.slice(0, 3).map(p => ({
      id: p.id,
      display_name: p.display_name,
      username: p.username,
      diamonds: p.diamonds
    }))
  });

  emitArena();
}

// ── GET WINNAAR ─────────────────────────────────────────────────────
export function getWinner(): Player | null {
  if (arena.players.length === 0) return null;
  return [...arena.players].sort((a, b) => b.diamonds - a.diamonds)[0];
}

// ── EMIT ARENA STATUS ───────────────────────────────────────────────
export function emitArena(): void {
  const data = {
    round: arena.round,
    type: arena.type,
    timeLeft: arena.timeLeft,
    isRunning: arena.isRunning,
    players: arena.players.map(p => ({
      id: p.id,
      display_name: p.display_name,
      username: p.username,
      diamonds: p.diamonds,
      boosters: p.boosters,
      status: p.status
    }))
  };

  io.emit('updateArena', data);
}

// ── GET ARENA (voor REST API) ───────────────────────────────────────
export function getArena(): any {
  return {
    round: arena.round,
    type: arena.type,
    timeLeft: arena.timeLeft,
    isRunning: arena.isRunning,
    players: arena.players.map(p => ({
      id: p.id,
      display_name: p.display_name,
      username: p.username,
      diamonds: p.diamonds,
      boosters: p.boosters,
      status: p.status
    }))
  };
}

// ── INIT ────────────────────────────────────────────────────────────
export function initGame(): void {
  console.log('[5-GAME-ENGINE] → Geladen en klaar voor oorlog');
  emitArena();
    }
