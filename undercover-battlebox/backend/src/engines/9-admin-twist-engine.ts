// ============================================================================
// 9-admin-twist-engine.ts — v2.6 (Danny Minimal Fix Build)
// ============================================================================
//
// Deze versie past ALLEEN de event-namen aan zodat de Admin UI werkt:
//
// UI → backend mapping:
//  admin:giveTwist   → geef een twist
//  admin:useTwist    → gebruik twist op target (admin force)
//
// Alle andere logica blijft exact zoals jij had.
//
// ============================================================================

import { Socket } from "socket.io";
import pool from "../db";
import { emitLog } from "../server";

import {
  giveTwistToUser,
  consumeTwistFromUser,
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

async function fetchUserByUsername(username: string) {
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

  return q.rows[0] || null;
}

// ============================================================================
// INIT ENGINE
// ============================================================================

export function initAdminTwistEngine(socket: Socket) {
  console.log("⚙️ Admin Twist Engine loaded (v2.6)");

  // ==========================================================================
  // ADMIN: GIVE TWIST   (UI: admin:giveTwist)
  // ==========================================================================
  socket.on(
    "admin:giveTwist",
    async (
      { username, twist }: { username: string; twist: string },
      ack: Function
    ) => {
      try {
        if (!username || !twist)
          return ack({ success: false, message: "Ontbrekende velden" });

        const cleanTwist = twist.toLowerCase().trim();

        if (!Object.prototype.hasOwnProperty.call(TWIST_MAP, cleanTwist)) {
          return ack({
            success: false,
            message: `Onbekende twist '${cleanTwist}'`,
          });
        }

        const twistType = cleanTwist as TwistType;

        const user = await fetchUserByUsername(username);
        if (!user) {
          return ack({
            success: false,
            message: "Gebruiker niet gevonden",
          });
        }

        await giveTwistToUser(user.tiktok_id.toString(), twistType);

        emitLog({
          type: "twist",
          message: `ADMIN gaf twist '${TWIST_MAP[twistType].giftName}' aan ${user.display_name}`,
        });

        ack({ success: true });
      } catch (err: any) {
        ack({ success: false, message: err.message });
      }
    }
  );

  // ==========================================================================
  // ADMIN: USE TWIST   (UI: admin:useTwist)
  // ==========================================================================
  socket.on(
    "admin:useTwist",
    async (
      {
        username,
        twist,
        target,
      }: { username: string; twist: string; target?: string },
      ack: Function
    ) => {
      try {
        if (!username || !twist)
          return ack({ success: false, message: "Ontbrekende velden" });

        const user = await fetchUserByUsername(username);
        if (!user)
          return ack({ success: false, message: "Gebruiker niet gevonden" });

        const cleaned = twist.toLowerCase().trim();

        const twistType = resolvedTwist(cleaned);
        if (!twistType)
          return ack({ success: false, message: "Onbekende twist" });

        await useTwist(
          user.tiktok_id.toString(),
          user.display_name,
          twistType,
          target
        );

        ack({ success: true });
      } catch (err: any) {
        ack({ success: false, message: err.message });
      }
    }
  );

  // ==========================================================================
  // ADMIN: LIST (optioneel, UI gebruikt dit niet)
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
  // ADMIN: CLEAR (optioneel, UI gebruikt dit niet)
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
