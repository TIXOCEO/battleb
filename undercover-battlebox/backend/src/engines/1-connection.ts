// src/engines/1-connection.ts
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
    // DIT IS DE ECHTE HOST VAN DE STREAM
    REAL_HOST_ID = state.hostId || state.roomInfo?.owner_user_id || '';
    if (!REAL_HOST_ID) return console.error('ECHTE HOST ID NIET GEVONDEN!');

    const hostInfo = state.roomInfo?.owner || state.user || {};
    REAL_HOST_NAME = hostInfo.nickname || 'Host';
    REAL_HOST_USERNAME = (hostInfo.uniqueId || 'host').replace('@', '');

    console.log('='.repeat(80));
    console.log('BATTLEBOX LIVE – ECHTE HOST GEVONDEN');
    console.log(`Host: ${REAL_HOST_NAME} (@${REAL_HOST_USERNAME}) [ID: ${REAL_HOST_ID}]`);
    console.log('Jij bent verbonden als gast/co-host');
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
