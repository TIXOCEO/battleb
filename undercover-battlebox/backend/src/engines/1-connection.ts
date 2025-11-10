// engines/1-connection.ts
import { WebcastPushConnection } from 'tiktok-live-connector';

let HOST_DISPLAY_NAME = 'Host';
let HOST_USERNAME = 'host';
let hostId = '';

export async function startConnection(username: string, onConnected: (state: any) => void) {
  const conn = new WebcastPushConnection(username);
  const pendingLikes = new Map<string, number>();
  const hasFollowed = new Set<string>();

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
    hostId = state.hostId || state.userId || state.user?.userId || '';
    if (!hostId) return console.error('HOST ID NIET GEVONDEN!');

    const hostNickname = state.user?.nickname || state.nickname || 'Host';
    const hostUniqueId = state.user?.uniqueId || state.uniqueId || 'host';

    HOST_DISPLAY_NAME = hostNickname;
    HOST_USERNAME = hostUniqueId.startsWith('@') ? hostUniqueId.slice(1) : hostUniqueId;

    console.log('='.repeat(80));
    console.log('BATTLEBOX LIVE – HOST PERFECT');
    console.log(`Host: ${HOST_DISPLAY_NAME} (@${HOST_USERNAME}) [ID: ${hostId}]`);
    console.log('='.repeat(80));

    onConnected(state);
  });

  return { conn, hostId: () => hostId, hostInfo: () => ({ HOST_DISPLAY_NAME, HOST_USERNAME }) };
}
