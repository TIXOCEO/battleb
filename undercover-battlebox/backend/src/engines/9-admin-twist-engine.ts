// ============================================================================
// 9-admin-twist-engine.ts — v2.5 (Danny Stable Build)
// ============================================================================
//
// Functies voor Admin Panel:
//  - twist:give      → geef een twist
//  - twist:remove    → verwijder één twist
//  - twist:list      → toon alle twists van een gebruiker
//  - twist:clear     → verwijder ALLE twists
//
// Let op:
//  ✔ Admin mag GEEN users aanmaken
//  ✔ DB-lookup alleen op bestaande usernames
//  ✔ tiktok_id blijft BigInt in database
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
} from "./twist-definitions";

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
// EXPORT: INIT ENGINE
// ============================================================================

export function initAdminTwistEngine(socket: Socket) {
  // ==========================================================================
  // ADMIN: GIVE TWIST
  // ==========================================================================
  socket.on(
    "admin:twist:give",
    async (
      { username, twist }: { username: string; twist: string },
      ack: Function
    ) => {
      try {
        const cleanTwist = twist.toLowerCase().trim();

        // ✔ TS-safe check voor geldige twist key
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
          message: `ADMIN gaf twist '${twistType}' aan ${user.display_name}`,
        });

        ack({ success: true });
      } catch (err: any) {
        ack({ success: false, message: err.message });
      }
    }
  );

  // ==========================================================================
  // ADMIN: REMOVE ONE
  // ==========================================================================
  socket.on(
    "admin:twist:remove",
    async (
      { username, twist }: { username: string; twist: string },
      ack: Function
    ) => {
      try {
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

        const ok = await consumeTwistFromUser(
          user.tiktok_id.toString(),
          twistType
        );

        if (!ok) {
          return ack({
            success: false,
            message: "Gebruiker heeft deze twist niet",
          });
        }

        emitLog({
          type: "twist",
          message: `ADMIN verwijderde twist '${twistType}' van ${user.display_name}`,
        });

        ack({ success: true });
      } catch (err: any) {
        ack({ success: false, message: err.message });
      }
    }
  );

  // ==========================================================================
  // ADMIN: LIST ALL TWISTS
  // ==========================================================================
  socket.on(
    "admin:twist:list",
    async (
      { username }: { username: string },
      ack: Function
    ) => {
      try {
        const user = await fetchUserByUsername(username);
        if (!user) {
          return ack({
            success: false,
            message: "Gebruiker niet gevonden",
          });
        }

        const items = await listTwistsForUser(user.tiktok_id.toString());

        ack({
          success: true,
          twists: items,
        });
      } catch (err: any) {
        ack({ success: false, message: err.message });
      }
    }
  );

  // ==========================================================================
  // ADMIN: CLEAR ALL TWISTS
  // ==========================================================================
  socket.on(
    "admin:twist:clear",
    async (
      { username }: { username: string },
      ack: Function
    ) => {
      try {
        const user = await fetchUserByUsername(username);
        if (!user) {
          return ack({
            success: false,
            message: "Gebruiker niet gevonden",
          });
        }

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
