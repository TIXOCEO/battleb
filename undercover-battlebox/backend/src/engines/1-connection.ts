// src/engines/1-connection.ts — SIMPEL & PERFECT
import { WebcastPushConnection } from 'tiktok-live-connector';

export async function startConnection(username: string, onConnected: (state: any) => void) {
  const conn = new WebcastPushConnection(username);

  for (let i = 0; i < 6; i++) {
    try {
      await conn.connect();
      console.info(`Verbonden met @${username}`);
      break;
    } catch (err: any) {
      console.error(`Poging ${i + 1} mislukt:`, err.message);
      if (i === 5) process.exit(1);
      await new Promise(r => setTimeout(r, 7000));
    }
  }

  conn.on('connected', (state) => {
    console.log('='.repeat(80));
    console.log('BATTLEBOX LIVE – VERBONDEN MET');
    console.log(`Live van: @${username}`);
    console.log('Alle gifts aan @' + username + ' = TWIST (geen arena)');
    console.log('Alle andere gifts = ARENA (tellen mee)');
    console.log('='.repeat(80));
    onConnected(state);
  });

  return { conn };
}
