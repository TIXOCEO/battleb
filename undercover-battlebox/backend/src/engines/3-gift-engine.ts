// ============================================================================
// 3-gift-engine.ts — v4.4 (Danny Safe Build + Debug)
// ============================================================================
//
// ✔ Twist-integratie (Galaxy, MoneyGun, Bomb, Immune, Heal, Diamond Pistol)
// ✔ Gift → twist mapping via giftId uit twist-definitions
// ✔ Support voor non-twist gifts (BP & diamonds)
// ✔ Host-only HeartMe → Fan 24h
// ✔ BigInt-safe
// ✔ Game boundaries correct (alleen in actieve/grace ronde voor spelers)
// ✔ Gifts naar host tellen apart mee (receiver_role = 'host')
// ✔ No duplicates (msgId-ratelimiter)
// ✔ Stable matcher met display_name en raw username
// ✔ Extra console-debug (RAW events, filters, fouten)
// ✔ onAny-debug om te zien of gifts op ander event type binnenkomen
//
// ============================================================================

import pool, { getSetting } from "../db";
import { getOrUpdateUser } from "./2-user-engine";
import { addDiamonds, addBP } from "./4-points-engine";
import { getArena, safeAddArenaDiamonds } from "./5-game-engine";
import { emitLog, io } from "../server";
import { TWIST_MAP, TwistType } from "./twist-definitions";
import { addTwistByGift } from "./8-twist-engine";

// ============================================================================
// Helpers
// ============================================================================

// Huidige game session uit io (voor gifts → game_id koppeling)
function getCurrentGameSessionId(): number | null {
  return (io as any).currentGameId ?? null;
}

// Normaliseer gebruikersnamen (zonder @, lowercase, alleen letters/cijfers/_)
function norm(v: any) {
  return (v || "")
    .toString()
    .trim()
    .replace("@", "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]/gu, "");
}

// Host cache (username, zonder @, lowercase)
let HOST_USERNAME_CACHE = "";

export async function initDynamicHost() {
  await refreshHostUsername();
}

export async function refreshHostUsername() {
  const h = (await getSetting("host_username")) || "";
  HOST_USERNAME_CACHE = h.trim().replace("@", "").toLowerCase();
  console.log("🔄 HOST UPDATED:", HOST_USERNAME_CACHE || "(none)");
}

// Processed message IDs om dubbele gifts te negeren
const processedMsgIds = new Set<string>();
setInterval(() => processedMsgIds.clear(), 60_000);

// Debug cache om username/display_name changes te loggen
const debugUserCache = new Map<
  string,
  { display_name: string; username: string }
>();

// ============================================================================
// Receiver resolver (host of speler)
// ============================================================================

async function resolveReceiver(event: any) {
  const hostRaw = HOST_USERNAME_CACHE;

  const eventId =
    event.receiverUserId ||
    event.toUserId ||
    event.toUser?.userId ||
    event.receiver?.userId ||
    null;

  const uniqueRaw =
    event.toUser?.uniqueId ||
    event.receiver?.uniqueId ||
    null;

  const nickRaw =
    event.toUser?.nickname ||
    event.receiver?.nickname ||
    null;

  const uniqueNorm = uniqueRaw ? norm(uniqueRaw) : null;
  const nickNorm = nickRaw ? norm(nickRaw) : null;

  // 1) Direct match op uniqueId == host username
  if (uniqueNorm && hostRaw && uniqueNorm === hostRaw) {
    return {
      id: null,
      username: hostRaw,
      display_name: uniqueRaw,
      role: "host" as const,
    };
  }

  // 2) Nickname bevat host naam
  if (nickNorm && hostRaw && nickNorm.includes(hostRaw)) {
    return {
      id: null,
      username: hostRaw,
      display_name: nickRaw,
      role: "host" as const,
    };
  }

  // 3) We hebben een eventId → lookup in users
  if (eventId) {
    const r = await getOrUpdateUser(
      String(eventId),
      nickRaw || null,
      uniqueRaw || null
    );

    // Debug: log wanneer naam verandert / onbekend → bekend
    const prev = debugUserCache.get(r.tiktok_id);
    if (
      !prev ||
      prev.display_name !== r.display_name ||
      prev.username !== r.username
    ) {
      debugUserCache.set(r.tiktok_id, {
        display_name: r.display_name,
        username: r.username,
      });

      emitLog({
        type: "system",
        message: `User update: ${r.tiktok_id} → ${r.display_name} (${r.username})`,
      });
      console.log(
        `🆕 USER RESOLVED/UPDATED: id=${r.tiktok_id} display="${r.display_name}" username="${r.username}"`
      );
    }

    // Is dit de host?
    if (hostRaw && norm(r.username) === hostRaw) {
      return {
        id: r.id,
        username: r.username.replace(/^@/, ""),
        display_name: r.display_name,
        role: "host" as const,
      };
    }

    // Normale speler
    return {
      id: r.id,
      username: r.username.replace(/^@/, ""),
      display_name: r.display_name,
      role: "speler" as const,
    };
  }

  // 4) Geen eventId, maar we weten de host naam
  if (hostRaw) {
    return {
      id: null,
      username: hostRaw,
      display_name: hostRaw,
      role: "host" as const,
    };
  }

  // Fallback onbekend speler
  return {
    id: null,
    username: "",
    display_name: "UNKNOWN",
    role: "speler" as const,
  };
}

// FAN 24h (HeartMe)
async function activateFan(userId: bigint) {
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await pool.query(
    `
    UPDATE users
    SET is_fan = true,
        fan_expires_at = $1
    WHERE tiktok_id = $2
    `,
    [expires, userId]
  );
}

// ============================================================================
// Core gift processing
// ============================================================================

async function processGiftEvent(data: any, source: string) {
  const rawClone = JSON.parse(JSON.stringify(data)); // voor debug logs

  // Debug RAW event
  console.log(`🔔 GIFT RAW (${source}):`, rawClone);

  // Dedup key
  const msgId =
    data.msgId ?? data.id ?? data.logId ?? `${source}-${data.giftId}-${Date.now()}`;
  const msgKey = String(msgId);

  if (msgKey && processedMsgIds.has(msgKey)) {
    console.log(`⚠️ Duplicate gift ignored: ${msgKey}`);
    return;
  }
  processedMsgIds.add(msgKey);

  try {
    // Sender parsing
    const senderId =
      data.user?.userId ||
      data.sender?.userId ||
      data.userId ||
      data.senderUserId;

    if (!senderId) {
      console.warn("⚠️ No senderId in gift event:", rawClone);
      return;
    }

    const sender = await getOrUpdateUser(
      String(senderId),
      data.user?.nickname || data.sender?.nickname || null,
      data.user?.uniqueId || data.sender?.uniqueId || null
    );

    const senderUsername = sender.username.replace(/^@/, "");

    // Diamonds/credits
    const rawDiamonds = Number(data.diamondCount || data.diamond || 0);
    if (rawDiamonds <= 0) {
      console.log("ℹ️ Gift met 0 diamonds genegeerd");
      return;
    }

    const repeatEnd = !!data.repeatEnd;
    const repeat = Number(data.repeatCount || 1);
    const giftType = Number(data.giftType || 0);

    // Zelfde berekening als oude engine:
    // giftType === 1 → alleen bij repeatEnd crediten
    const credited =
      giftType === 1
        ? repeatEnd
          ? rawDiamonds * repeat
          : 0
        : rawDiamonds;

    if (credited <= 0) {
      console.log(
        `ℹ️ Gift nog in streak (repeat) → nog niet crediten (giftType=${giftType}, repeatEnd=${repeatEnd})`
      );
      return;
    }

    // Receiver bepalen (host/speler)
    const receiver = await resolveReceiver(data);
    const isHost = receiver.role === "host";

    console.log(
      `🎁 PARSED GIFT: ${sender.display_name} (@${senderUsername}) → ${receiver.display_name} (${receiver.role}) | ${data.giftName} (${credited}💎)`
    );

    const gameId = getCurrentGameSessionId();
    const arena = getArena();
    const now = Date.now();

    const inActive = arena.status === "active" && now <= arena.roundCutoff;
    const inGrace = arena.status === "grace" && now <= arena.graceEnd;
    const inRound = inActive || inGrace;

    // Filterregels:
    if (isHost && !gameId) {
      console.log(
        "ℹ️ Gift aan host, maar geen actieve game → alleen loggen, niet koppelen aan game"
      );
    }

    if (!isHost && !inRound) {
      console.log(
        `ℹ️ Gift aan speler buiten ronde (status=${arena.status}) → geen ronde-credits`
      );
    }

    // DIAMONDS/BP ALTIJD OP SENDER
    await addDiamonds(BigInt(senderId), credited, "total");
    await addDiamonds(BigInt(senderId), credited, "stream");
    await addDiamonds(BigInt(senderId), credited, "current_round");

    const bpGain = credited * 0.2;
    await addBP(BigInt(senderId), bpGain, "GIFT", sender.display_name);

    // In-arena diamonds alleen als: niet host én in ronde & receiver bekend
    if (!isHost && receiver.id && inRound) {
      await safeAddArenaDiamonds(receiver.id.toString(), credited);
    }

    // ------------------------------
    // TWIST GIFTS
    // ------------------------------
    const giftId = Number(data.giftId);
    let twistType: TwistType | null = null;

    for (const key of Object.keys(TWIST_MAP) as TwistType[]) {
      if (TWIST_MAP[key].giftId === giftId) {
        twistType = key;
        break;
      }
    }

    if (twistType) {
      await addTwistByGift(String(senderId), twistType);

      emitLog({
        type: "twist",
        message: `${sender.display_name} ontving twist: ${TWIST_MAP[twistType].giftName}`,
      });

      console.log(
        `🌀 TWIST TRIGGERED: ${sender.display_name} → ${TWIST_MAP[twistType].giftName} (giftId=${giftId})`
      );
    }

    // FANCLUB via HeartMe (alleen wanneer gift naar host)
    if (
      isHost &&
      (data.giftName?.toLowerCase() === "heart me" || data.giftId === 5655)
    ) {
      await activateFan(BigInt(senderId));

      emitLog({
        type: "gift",
        message: `${sender.display_name} werd FAN voor 24h ❤️`,
      });

      console.log(`❤️ HEART ME FAN: ${sender.display_name} → FAN 24h`);
    }

    // ------------------------------
    // SAVE IN DATABASE
    // ------------------------------
    await pool.query(
      `
        INSERT INTO gifts (
          giver_id, giver_username, giver_display_name,
          receiver_id, receiver_username, receiver_display_name,
          receiver_role, gift_name, diamonds, bp, game_id, created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
      `,
      [
        BigInt(senderId),
        senderUsername,
        sender.display_name,
        receiver.id ? BigInt(receiver.id) : null,
        receiver.username,
        receiver.display_name,
        receiver.role,
        data.giftName || "unknown",
        credited,
        bpGain,
        gameId,
      ]
    );

    emitLog({
      type: "gift",
      message: `${sender.display_name} → ${receiver.display_name}: ${
        data.giftName || "unknown"
      } (${credited}💎)`,
    });

    console.log(
      `✅ GIFT STORED: sender=${senderUsername}, receiver=${receiver.username} (${receiver.role}), gift="${data.giftName}", diamonds=${credited}, gameId=${gameId}`
    );
  } catch (err: any) {
    console.error("❌ GiftEngine ERROR:", err?.message || err);
    console.error("RAW EVENT (on error):", rawClone);
  }
}

// ============================================================================
// GIFT ENGINE INIT
// ============================================================================

export function initGiftEngine(conn: any) {
  if (!conn) {
    console.warn("⚠ initGiftEngine zonder koppeling → IDLE-modus");
    return;
  }

  if (typeof conn.on !== "function") {
    console.warn("⚠ Foute conn in initGiftEngine → IDLE-modus");
    return;
  }

  console.log("🎁 GIFT ENGINE v4.4 LOADED WITH DEBUG");

  // Debug: log alle event types 1x (voor analyse of gifts via andere naam komen)
  if (typeof conn.onAny === "function") {
    let debugCount = 0;
    conn.onAny((eventName: string, eventData: any) => {
      if (debugCount < 20) {
        console.log("📡 onAny EVENT:", eventName, "→ sample:", {
          hasGiftId: !!eventData?.giftId,
          hasDiamondCount: !!eventData?.diamondCount,
          keys: Object.keys(eventData || {}),
        });
        debugCount++;
        if (debugCount === 20) {
          console.log(
            "📡 onAny debug limit reached (20). Verdere events niet meer gelogd."
          );
        }
      }
    });
  }

  // Standaard gift event
  conn.on("gift", async (data: any) => {
    await processGiftEvent(data, "gift");
  });

  // Sommige libraries sturen gifts via andere events → fallback
  conn.on("roomMessage", async (data: any) => {
    if (data && (data.giftId || data.diamondCount)) {
      await processGiftEvent(data, "roomMessage");
    }
  });
}
