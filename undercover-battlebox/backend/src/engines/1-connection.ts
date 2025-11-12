import { WebcastPushConnection } from "tiktok-live-connector";
import { upsertIdentityFromLooseEvent } from "./2-user-engine";

/**
 * Start TikTok connection met retry + identity-updaters.
 * @param username TikTok host username (zonder @ of met @ – beide oké)
 * @param onConnected callback na succesvolle connect
 */
export async function startConnection(
  username: string,
  onConnected: () => void
) {
  const host = username.replace(/^@+/, "");
  const conn = new WebcastPushConnection(host);

  // —— Verbinden met retries
  for (let i = 0; i < 6; i++) {
    try {
      await conn.connect();
      console.info(`Verbonden met @${host}`);
      break;
    } catch (err: any) {
      console.error(`Poging ${i + 1} mislukt:`, err?.message || err);
      if (i === 5) process.exit(1);
      await new Promise((r) => setTimeout(r, 7000));
    }
  }

  conn.on("connected", () => {
    console.log("=".repeat(80));
    console.log("BATTLEBOX LIVE – VERBONDEN MET @" + host);
    console.log("Gifts aan @" + host + " = TWIST (geen arena)");
    console.log("Alle andere gifts = ARENA (op ontvanger/speler)");
    console.log("=".repeat(80));
    onConnected();
  });

  // —— Identity updaters (zodat Onbekend snel verdwijnt)
  attachIdentityUpdaters(conn);

  return { conn };
}

/**
 * Luistert breed op events en probeert de user zo snel mogelijk
 * te updaten / aan te maken met (id, display_name, uniqueId).
 * Dit dekt: chat, like, follow, share/social, member/join én gift
 * (zowel zender als ontvanger – extra veiligheid naast gift-engine).
 */
function attachIdentityUpdaters(conn: any) {
  // 1) Chat-berichten (meest frequent en snel → perfecte bron)
  conn.on("chat", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);
  });

  // 2) Likes (zeer frequent; bevat user)
  conn.on("like", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);
  });

  // 3) Follow
  conn.on("follow", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);
  });

  // 4) Share / Social
  conn.on("social", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);
  });

  // 5) Member (join). Sommige events heten 'member' in deze lib (joiners).
  conn.on("member", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d);
  });

  // 6) Subscription (soms met user)
  conn.on("subscribe", (d: any) => {
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);
  });

  // 7) Gift (zowel sender als ontvanger bijwerken; de gift-engine doet dit ook,
  //    maar dit is extra defensief en versnelt upgrades naar echte namen)
  conn.on("gift", (d: any) => {
    // Zender
    upsertIdentityFromLooseEvent(d?.user || d?.sender || d);
    // Ontvanger (cohost/speler)
    if (d?.toUser || d?.receiver) {
      upsertIdentityFromLooseEvent(d?.toUser || d?.receiver);
    }
  });

  // (Eventueel kun je hier later nog 'linkMicBattle' etc. aanhaken)
}
