// ARENA ENGINE – rondebeheer, countdown, grace-periode, live ranking

import { io } from "../server";
import pool from "../db";
import { addDiamonds } from "./4-points-engine";

// === Types ===
export type ArenaStatus = "idle" | "active" | "grace" | "ended";
export type RoundType = "quarter" | "semi" | "finale";

interface Player {
  id: string;
  display_name: string;
  username: string;
  diamonds: number; // diamonds binnen de HUIDIGE ronde
  boosters: string[];
  status: "alive" | "eliminated";
  joined_at: number;
}

interface ArenaSettings {
  roundDurationPre: number; // seconden (voorrondes)
  roundDurationFinal: number; // seconden (finale)
  graceSeconds: number; // seconden
}

interface Arena {
  players: Player[];
  round: number;
  type: RoundType;
  status: ArenaStatus;
  timeLeft: number; // seconden
  isRunning: boolean; // legacy compat
  roundStartTime: number; // ms epoch
  roundCutoff: number; // ms epoch → einde 00:00
  graceEnd: number; // ms epoch → einde grace
  settings: ArenaSettings;
  lastSortedAt: number;
}

// === State ===
const DEFAULT_SETTINGS: ArenaSettings = {
  roundDurationPre: 180,
  roundDurationFinal: 300,
  graceSeconds: 5,
};

const arena: Arena = {
  players: [],
  round: 0,
  type: "quarter",
  status: "idle",
  timeLeft: 0,
  isRunning: false,
  roundStartTime: 0,
  roundCutoff: 0,
  graceEnd: 0,
  settings: { ...DEFAULT_SETTINGS },
  lastSortedAt: Date.now(),
};

// === Settings persistence ===
async function loadArenaSettingsFromDB(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  const { rows } = await pool.query(
    `SELECT key, value FROM settings WHERE key IN ('roundDurationPre','roundDurationFinal','graceSeconds')`
  );

  const map = new Map(rows.map((r: any) => [r.key, r.value]));
  const pre = Number(map.get("roundDurationPre") ?? DEFAULT_SETTINGS.roundDurationPre);
  const fin = Number(map.get("roundDurationFinal") ?? DEFAULT_SETTINGS.roundDurationFinal);
  const gr = Number(map.get("graceSeconds") ?? DEFAULT_SETTINGS.graceSeconds);

  arena.settings = {
    roundDurationPre: Number.isFinite(pre) && pre > 0 ? pre : DEFAULT_SETTINGS.roundDurationPre,
    roundDurationFinal: Number.isFinite(fin) && fin > 0 ? fin : DEFAULT_SETTINGS.roundDurationFinal,
    graceSeconds: Number.isFinite(gr) && gr >= 0 ? gr : DEFAULT_SETTINGS.graceSeconds,
  };
}

async function saveArenaSettingsToDB(s: Partial<ArenaSettings>): Promise<void> {
  const merged: ArenaSettings = { ...arena.settings, ...s };
  arena.settings = merged;

  const pairs: [string, number][] = [
    ["roundDurationPre", merged.roundDurationPre],
    ["roundDurationFinal", merged.roundDurationFinal],
    ["graceSeconds", merged.graceSeconds],
  ];

  for (const [k, v] of pairs) {
    await pool.query(
      `INSERT INTO settings(key, value) VALUES ($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [k, String(v)]
    );
  }
  emitArena();
}

// === Public settings API (server gebruikt deze) ===
export async function updateArenaSettings(s: Partial<ArenaSettings>) {
  await saveArenaSettingsToDB(s);
}
export function getArenaSettings(): ArenaSettings {
  return { ...arena.settings };
}

// === Arena helpers ===
function sortPlayers(): void {
  // Hoogste diamonds bovenaan, bij gelijk die eerder joined is boven
  arena.players.sort((a, b) => b.diamonds - a.diamonds || a.joined_at - b.joined_at);
  arena.lastSortedAt = Date.now();
}

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
  sortPlayers();
  emitArena();
  return true;
}

export function arenaLeave(tiktok_id: string): void {
  const idx = arena.players.findIndex((p) => p.id === tiktok_id);
  if (idx === -1) return;
  arena.players.splice(idx, 1);
  sortPlayers();
  emitArena();
}

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
  arena.status = "idle";
  arena.timeLeft = 0;
  arena.isRunning = false;
  arena.roundStartTime = 0;
  arena.roundCutoff = 0;
  arena.graceEnd = 0;
  sortPlayers();
  emitArena();
}

// Diamonds naar ONTVANGER (gift-engine roept dit aan)
export async function addDiamondsToArenaPlayer(
  tiktok_id: string,
  d: number
): Promise<void> {
  const p = arena.players.find((pp) => pp.id === tiktok_id);
  if (!p) return;
  p.diamonds += d;
  await addDiamonds(BigInt(tiktok_id), d, "current_round");
  sortPlayers();
  emitArena();
}

// Rondebesturing
let roundTick: NodeJS.Timeout | null = null;

function getDurationForType(type: RoundType): number {
  return type === "finale"
    ? arena.settings.roundDurationFinal
    : arena.settings.roundDurationPre;
}

export function startRound(type: RoundType): boolean {
  if (arena.status === "active" || arena.status === "grace") return false;
  if (arena.players.length < 2) return false;

  arena.round += 1;
  arena.type = type;

  const total = getDurationForType(type);
  arena.timeLeft = total;
  arena.isRunning = true;
  arena.status = "active";
  arena.roundStartTime = Date.now();
  arena.roundCutoff = arena.roundStartTime + total * 1000;
  arena.graceEnd = arena.roundCutoff + arena.settings.graceSeconds * 1000;

  // Ronde-diamonds visuals resetten
  for (const p of arena.players) p.diamonds = 0;

  sortPlayers();
  emitArena();
  io.emit("round:start", { round: arena.round, type: arena.type, duration: total });

  if (roundTick) clearInterval(roundTick);
  roundTick = setInterval(() => {
    const now = Date.now();

    if (arena.status === "active") {
      const left = Math.max(0, Math.ceil((arena.roundCutoff - now) / 1000));
      arena.timeLeft = left;

      if (left <= 0) {
        // 00:00 exact → stop punten, ga naar grace
        arena.status = "grace";
        arena.isRunning = false;
        arena.timeLeft = 0;
        emitArena();
        io.emit("round:grace", {
          round: arena.round,
          grace: arena.settings.graceSeconds,
        });
      } else {
        emitArena();
      }
      return;
    }

    if (arena.status === "grace") {
      if (now >= arena.graceEnd) {
        endRound();
      } else {
        emitArena();
      }
      return;
    }

    if (arena.status === "ended" || arena.status === "idle") {
      if (roundTick) {
        clearInterval(roundTick);
        roundTick = null;
      }
    }
  }, 1000);

  return true;
}

export function endRound(): void {
  arena.status = "ended";
  arena.isRunning = false;
  arena.timeLeft = 0;

  sortPlayers();
  emitArena();

  const sorted = [...arena.players];
  const top3 = sorted.slice(0, 3).map((p) => ({
    id: p.id,
    display_name: p.display_name,
    username: p.username,
    diamonds: p.diamonds,
  }));

  io.emit("round:end", {
    round: arena.round,
    type: arena.type,
    top3,
  });

  if (roundTick) {
    clearInterval(roundTick);
    roundTick = null;
  }
}

// === Snapshot export ===
export function getArena() {
  sortPlayers();
  return {
    players: arena.players.map((p) => ({
      id: p.id,
      display_name: p.display_name,
      username: p.username.replace(/^@+/, ""),
      diamonds: p.diamonds,
      boosters: p.boosters,
      status: p.status,
    })),
    round: arena.round,
    type: arena.type,
    status: arena.status,
    timeLeft: arena.timeLeft,
    isRunning: arena.isRunning,
    roundStartTime: arena.roundStartTime,
    roundCutoff: arena.roundCutoff,
    graceEnd: arena.graceEnd,
    settings: arena.settings,
    lastSortedAt: arena.lastSortedAt,
  };
}

export function emitArena() {
  io.emit("updateArena", getArena());
}

export async function initGame() {
  await loadArenaSettingsFromDB();
  sortPlayers();
  emitArena();
}
