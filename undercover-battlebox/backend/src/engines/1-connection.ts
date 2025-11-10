// src/engines/1-connection.ts — ECHTE HOST ALTIJD CORRECT – FINAL VERSION
import { WebcastPushConnection } from 'tiktok-live-connector';

let REAL_HOST_ID = '';
let REAL_HOST_NAME = 'Host';
let REAL_HOST_USERNAME = 'host';

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

  conn.on('connected', async (state) => {
    // DIT IS DE ECHTE HOST VAN DE STREAM – ALTIJD CORRECT
    REAL_HOST_ID = state.roomInfo?.owner?.userId || state.hostId || state.roomInfo?.owner_user_id || '';
    
    if (!REAL_HOST_ID) {
      console.error('ECHTE HOST ID NIET GEVONDEN! Gebruik !adm sethost @naam');
      REAL_HOST_ID = 'FORCE_MANUAL';
      onConnected(state);
      return;
    }

    const owner = state.roomInfo?.owner || {};
    REAL_HOST_NAME = owner.nickname || owner.displayName || 'Host';
    REAL_HOST_USERNAME = (owner.uniqueId || owner.username || 'host').replace('@', '');

    console.log('='.repeat(80));
    console.log('BATTLEBOX LIVE – ECHTE HOST CORRECT GEVONDEN');
    console.log(`Host: ${REAL_HOST_NAME} (@${REAL_HOST_USERNAME})`);
    console.log(`Host ID: ${REAL_HOST_ID}`);
    console.log(`Jij bent verbonden als: @${username} (co-host / gast)`);
    console.log('='.repeat(80));

    onConnected(state);
  });

  return {
    conn,
    getRealHost: () => ({
      id: REAL_HOST_ID,
      name: REAL_HOST_NAME,
      username: REAL_HOST_USERNAME
    })
  };
}
