// ============================================================================
// 9-admin-twist-engine.ts — v2.7 (Danny Stable Fix Build)
// ============================================================================
//
// ✔ Export giveTwistAdmin / useTwistAdmin voor server.ts
// ✔ initAdminTwistEngine alleen voor list/clear events
// ✔ Volledige integratie met twist-inventory + 8-twist-engine
// ✔ Geen dubbele admin:giveTwist / admin:useTwist handlers meer
//
// ============================================================================

import { Socket } from "socket.io";
import pool from "../db";
import { emitLog } from "../server";

import {
  giveTwistToUser,
  listTwistsForUser,
  clearTwistsForUser,
} from "./twist-inventory";

import {
  TWIST_MAP,
  type TwistType,
  resolveTwistAlias,
} from "./twist-definitions";

import { useTwist } from "./8-twist-engine";

// ============================================================================
// INTERNAL — USER LOOKUP
// ============================================================================

type TwistUserRow = {
  tiktok_id: string;
  username: string;
  display_name: string;
};

async function fetchUserByUsername(username: string): Promise<TwistUserRow | null> {
  const clean = username.replace("@", "").toLowerCase().trim();

  const q = await pool.query(
    `
      SELECT tiktok_id, display_name, username
      FROM users
      WHERE LOWER(username) = $1
      LIMIT 1
    `,
    [clean]
  );

  return (q.rows[0] as TwistUserRow) || null;
}

// ============================================================================
// SMALL HELPER
// ============================================================================

function resolvedTwist(str: string): TwistType | null {
  const alias = resolveTwistAlias(str);
  if (alias) return alias;

  return Object.prototype.hasOwnProperty.call(TWIST_MAP, str)
    ? (str as TwistType)
    : null;
}

// ============================================================================
// EXPORTED ADMIN HELPERS (server.ts gebruikt deze)
// ============================================================================

export async function giveTwistAdmin(
  username: string,
  twist: string
): Promise<void> {
  if (!username || !twist) {
    throw new Error("Ontbrekende velden");
  }

  const cleanTwist = twist.toLowerCase().trim();
  if (!Object.prototype.hasOwnProperty.call(TWIST_MAP, cleanTwist)) {
    throw new Error(`Onbekende twist '${cleanTwist}'`);
  }

  const twistType = cleanTwist as TwistType;

  const user = await fetchUserByUsername(username);
  if (!user) {
    throw new Error("Gebruiker niet gevonden");
  }

  await giveTwistToUser(user.tiktok_id.toString(), twistType);

  emitLog({
    type: "twist",
    message: `ADMIN gaf twist '${TWIST_MAP[twistType].giftName}' aan ${user.display_name}`,
  });
}

export async function useTwistAdmin(
  username: string,
  twist: string,
  target?: string
): Promise<void> {
  if (!username || !twist) {
    throw new Error("Ontbrekende velden");
  }

  const user = await fetchUserByUsername(username);
  if (!user) {
    throw new Error("Gebruiker niet gevonden");
  }

  const cleaned = twist.toLowerCase().trim();
  const twistType = resolvedTwist(cleaned);
  if (!twistType) {
    throw new Error("Onbekende twist");
  }

  await useTwist(
    user.tiktok_id.toString(),
    user.display_name,
    twistType,
    target
  );
}

// ============================================================================
// INIT ENGINE — extra admin events (list / clear)
// ============================================================================

export function initAdminTwistEngine(socket: Socket) {
  console.log("⚙️ Admin Twist Engine loaded (v2.7)");

  // ==========================================================================
  // ADMIN: LIST (optioneel, UI gebruikt dit nu niet actief)
  // ==========================================================================
  socket.on(
    "admin:twist:list",
    async ({ username }: { username: string }, ack: Function) => {
      try {
        const user = await fetchUserByUsername(username);
        if (!user)
          return ack({ success: false, message: "Gebruiker niet gevonden" });

        const items = await listTwistsForUser(user.tiktok_id.toString());

        ack({ success: true, twists: items });
      } catch (err: any) {
        ack({ success: false, message: err.message });
      }
    }
  );

  // ==========================================================================
  // ADMIN: CLEAR (optioneel, UI gebruikt dit nu niet actief)
  // ==========================================================================
  socket.on(
    "admin:twist:clear",
    async ({ username }: { username: string }, ack: Function) => {
      try {
        const user = await fetchUserByUsername(username);
        if (!user)
          return ack({ success: false, message: "Gebruiker niet gevonden" });

        await clearTwistsForUser(user.tiktok_id.toString());

        emitLog({
          type: "twist",
          message: `ADMIN verwijderde ALLE twists van ${user.display_name}`,
        });

        ack({ success: true });
      } catch (err: any) {
        ack({ success: false, message: err.message });
      }
    }
  );
}
