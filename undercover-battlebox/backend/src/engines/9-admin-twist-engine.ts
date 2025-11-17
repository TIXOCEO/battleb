// ============================================================================
// 9-admin-twist-engine.ts — v2.1 (Build-Safe, TS-Safe)
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
// INTERNAL: fetch user
// ============================================================================
async function fetchUserByUsername(username: string) {
  const clean = username.replace("@", "").toLowerCase();

  const res = await pool.query(
    `
    SELECT tiktok_id, display_name, username
    FROM users
    WHERE LOWER(username) = $1
    LIMIT 1
    `,
    [clean]
  );

  return res.rows[0] || null;
}

// ============================================================================
// EXPORT
// ============================================================================

export function initAdminTwistEngine(socket: Socket) {
  // ========================================================================
  // ADMIN: Geef twist
  // ========================================================================
  socket.on(
    "admin:twist:give",
    async (
      { username, twist }: { username: string; twist: string },
      ack: Function
    ) => {
      try {
        const clean = twist.toLowerCase().trim();

        // ⭐ TypeScript-save key check
        if (!Object.prototype.hasOwnProperty.call(TWIST_MAP, clean)) {
          return ack({
            success: false,
            message: `Onbekende twist '${clean}'`,
          });
        }

        const twistType = clean as TwistType;

        const user = await fetchUserByUsername(username);
        if (!user) {
          return ack({
            success: false,
            message: "Gebruiker niet gevonden",
          });
        }

        await giveTwistToUser(user.tiktok_id, twistType);

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

  // ========================================================================
  // ADMIN: Verwijder één twist
  // ========================================================================
  socket.on(
    "admin:twist:remove",
    async (
      { username, twist }: { username: string; twist: string },
      ack: Function
    ) => {
      try {
        const clean = twist.toLowerCase().trim();

        if (!Object.prototype.hasOwnProperty.call(TWIST_MAP, clean)) {
          return ack({
            success: false,
            message: `Onbekende twist '${clean}'`,
          });
        }

        const twistType = clean as TwistType;

        const user = await fetchUserByUsername(username);
        if (!user) {
          return ack({
            success: false,
            message: "Gebruiker niet gevonden",
          });
        }

        const ok = await consumeTwistFromUser(user.tiktok_id, twistType);
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

  // ========================================================================
  // ADMIN: Toon inventory
  // ========================================================================
  socket.on(
    "admin:twist:list",
    async ({ username }: { username: string }, ack: Function) => {
      try {
        const user = await fetchUserByUsername(username);
        if (!user) {
          return ack({
            success: false,
            message: "Gebruiker niet gevonden",
          });
        }

        const items = await listTwistsForUser(user.tiktok_id);

        ack({
          success: true,
          twists: items,
        });
      } catch (err: any) {
        ack({ success: false, message: err.message });
      }
    }
  );

  // ========================================================================
  // ADMIN: Clear ALL twists
  // ========================================================================
  socket.on(
    "admin:twist:clear",
    async ({ username }: { username: string }, ack: Function) => {
      try {
        const user = await fetchUserByUsername(username);
        if (!user) {
          return ack({
            success: false,
            message: "Gebruiker niet gevonden",
          });
        }

        await clearTwistsForUser(user.tiktok_id);

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
