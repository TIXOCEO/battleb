// backend/src/game.ts
import pool from './db';
import { io } from './server';

let socketServer: any = null;
export function initGame(server: any) {
  socketServer = server;
}

// === BATTLEBOX ARENA – ALLEEN ECHTE MULTI-GUEST (MAX 8) ===
const arena = new Set<string>();
const arenaCache = new Map<string, { display_name: string; username: string; role: string }>();

async function emitArena() {
  const arenaList = Array.from(arena).map(userIdStr => {
    const data = arenaCache.get(userIdStr);
    return data ? {
      userId: userIdStr,
      display_name: data.display_name,
      username: data.username,
      role: data.role,
      inArena: true
    } : null;
  }).filter(Boolean);

  if (socketServer) {
    socketServer.emit('arena:update', arenaList);
    socketServer.emit('arena:count', arenaList.length);
  }
  console.log(`[BB DEBUG] Arena update → ${arenaList.length} vechters: ${arenaList.map(u => u?.display_name).join(', ')}`);
}

export function getArena() {
  return Array.from(arena).map(userIdStr => {
    const data = arenaCache.get(userIdStr);
    return data ? { ...data, inArena: true } : null;
  }).filter(Boolean);
}

export function arenaJoin(userId: string, display_name: string, username: string, role: string = 'fighter') {
  if (arena.has(userId)) return;
  arena.add(userId);
  arenaCache.set(userId, { 
    display_name, 
    username: '@' + username.toLowerCase(),
    role 
  });
  console.log(`[BB JOIN] ${display_name} (@${username.toLowerCase()}) → ECHTE GAST IN BATTLEBOX (${role})`);
  emitArena();
}

export function arenaLeave(userId: string) {
  if (!arena.has(userId)) return;
  const data = arenaCache.get(userId);
  const name = data?.display_name || 'Onbekend';
  const user = data?.username?.slice(1) || 'onbekend';
  arena.delete(userId);
  arenaCache.delete(userId);
  console.log(`[BB LEAVE] ${name} (@${user}) → verlaat de BattleBox`);
  emitArena();
}

export function arenaClear() {
  const count = arena.size;
  arena.clear();
  arenaCache.clear();
  console.log(`[BB END] Stream eindigt – ${count} vechters verwijderd uit BattleBox`);
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
