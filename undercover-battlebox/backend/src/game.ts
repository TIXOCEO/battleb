// backend/src/game.ts
// BATTLEBOX CORE GAME ENGINE – ARENA TRACKING & DASHBOARD
import pool from './db';

let socketServer: any = null;

export function initGame(server: any) {
  socketServer = server;
}

const arena = new Set<string>(); // userIdStr van BB-deelnemers
const arenaCache = new Map<string, { display_name: string; username: string; joined_at: Date }>();

export async function emitArena() {
  const arenaList = Array.from(arena).map(userIdStr => {
    const data = arenaCache.get(userIdStr);
    if (!data) return null;
    return {
      userId: userIdStr,
      display_name: data.display_name,
      username: data.username,
      joined_at: data.joined_at,
      inArena: true
    };
  }).filter(Boolean);

  if (socketServer) {
    socketServer.emit('arena:update', arenaList);
    socketServer.emit('arena:count', arenaList.length);
  }
}

export function getArena() {
  return Array.from(arena).map(userIdStr => {
    const data = arenaCache
