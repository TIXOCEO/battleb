// backend/src/game.ts
import pool from './db';
import { io } from './server';

let socketServer: any = null;
export function initGame(server: any) {
  socketServer = server;
}

const arena = new Set<string>();
const arenaCache = new Map<string, { display_name: string; username: string }>();

async function emitArena() {
  const arenaList = Array.from(arena).map(userIdStr => {
    const data = arenaCache.get(userIdStr);
    return data ? {
      userId: userIdStr,
      display_name: data.display_name,  // ← GEFIXT
      username: data.username,
      inArena: true
    } : null;
  }).filter(Boolean);

  if (socketServer) {
    socketServer.emit('arena:update', arenaList);
    socketServer.emit('arena:count', arenaList.length);
  }
}

export function getArena() {
  return Array.from(arena).map(userIdStr => {
    const data = arenaCache.get(userIdStr);
    return data ? { ...data, inArena: true } : null;
  }).filter(Boolean);
}

export function arenaJoin(userId: string, display_name: string, username: string) {
  arena.add(userId);
  arenaCache.set(userId, { display_name, username: '@' + username.toLowerCase() });
  console.log(`[BB JOIN] ${display_name} (${'@' + username.toLowerCase()}) treedt de BattleBox binnen!`);
  emitArena();
}

export function arenaLeave(userId: string) {
  if (arena.has(userId)) {
    const data = arenaCache.get(userId);
    const name = data?.display_name || 'Onbekend';
    const user = data?.username?.slice(1) || 'onbekend';
    arena.delete(userId);
    arenaCache.delete(userId);
    console.log(`[BB LEAVE] ${name} (@${user}) verlaat de BattleBox!`);
    emitArena();
  }
}

export function arenaClear() {
  const count = arena.size;
  arena.clear();
  arenaCache.clear();
  console.log(`[BB END] Arena leeg – ${count} vechters verwijderd`);
  emitArena();
}

export async function addBP(
  tiktok_id: bigint,
  amount: number,
  action: string,
  display_name: string,
  isFan: boolean,
  isVip: boolean
) {
  const oldRes = await pool.query('SELECT bp_total FROM users WHERE tiktok_id = $1', [tiktok_id]);
  const oldBP = parseFloat(oldRes.rows[0]?.bp_total) || 0;

  await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [amount, tiktok_id]);

  const newRes = await pool.query('SELECT bp_total FROM users WHERE tiktok_id = $1', [tiktok_id]);
  const newBP = parseFloat(newRes.rows[0].bp_total) || 0;

  const userIdStr = tiktok_id.toString();
  const bbTag = arena.has(userIdStr) ? ' [BB]' : '';
  const fanTag = isFan ? ' [FAN]' : '';
  const vipTag = isVip ? ' [VIP]' : '';

  console.log(`[${action}]${bbTag} ${display_name}${fanTag}${vipTag}`);
  console.log(`[BP: +${amount} | ${oldBP.toFixed(1)} → ${newBP.toFixed(1)}]`);
}

export { emitArena };
