// ============================================================================
// 9-admin-twist-engine.ts — Admin Twist Engine v1.0 (FINAL)
// ============================================================================
//
// Dit bestand regelt ALLE twist-acties vanuit de ADMIN DASHBOARD:
//
//   ✅ admin:giveTwist    → geef een twist tegoed aan gebruiker
//   ✅ admin:useTwist     → gebruik twist namens speler
//   ✅ admin:getTwistInv  → haal inventory op
//
// Belangrijk:
//  - Admin omzeilt DIAMOND kosten
//  - Admin mag twist gebruiken zonder chat
//  - Admin mag twist direct op target richten
//  - Admin interactie loopt ALTIJD via twist-engine.ts
//
// Afhankelijk van:
//  - twist-engine
//  - twist-definitions
//  - twist-inventory
//  - server socket (emitLog / ack)
//  - user-engine
//
// ============================================================================

import { io } from "../server";
import { getOrUpdateUser } from "./2-user-engine";

import {
  addTwistToUser,
  getUserTwistInventory,
  userHasTwist,
  consumeTwistFromUser,
} from "./twist-inventory";

import {
  TWIST_MAP,
  findTwistByAlias,
  TwistType,
} from "./twist-definitions";

import { useTwist } from "./8-twist-engine";
import pool from "../db";

// ============================================================================
// Helper: zoek user op username
// ============================================================================

async function findUserByUsername(raw: string) {
  const clean = raw.replace("@", "").trim().toLowerCase();

  const { rows } = await pool.query(
    `
      SELECT tiktok_id, username, display_name
      FROM users
      WHERE LOWER(username) = LOWER($1)
      LIMIT 1
    `,
    [clean]
  );

  if (!rows[0]) return null;

  return {
    id: rows[0].tiktok_id.toString(),
    username: rows[0].username.replace("@", ""),
    display_name: rows[0].display_name,
  };
}

// ============================================================================
// ADMIN EVENT HANDLERS
// ============================================================================

export function initAdminTwistEngine(adminSocket: any) {
  // --------------------------------------------------------------------------
  // 1. ADMIN → GEEF TWIST TEGOED
  // --------------------------------------------------------------------------
  adminSocket.on(
    "admin:giveTwist",
    async (payload: { username: string; twist: string; amount: number },
      ack: Function
    ) => {
      try {
        const { username, twist, amount } = payload;

        const t = findTwistByAlias(twist.toLowerCase());
        if (!t) {
          return ack({
            success: false,
            message: `Twist '${twist}' bestaat niet.`,
          });
        }

        const user = await findUserByUsername(username);
        if (!user) {
          return ack({
            success: false,
            message: `Gebruiker '${username}' niet gevonden.`,
          });
        }

        await addTwistToUser(user.id, t, amount);

        ack({
          success: true,
          message: `Twist ${t} toegevoegd aan @${user.username}.`,
        });

        io.emit("log", {
          type: "twist",
          timestamp: Date.now(),
          message: `ADMIN gaf ${amount}× ${t} aan ${user.display_name}.`,
        });
      } catch (e: any) {
        ack({ success: false, message: e.message });
      }
    }
  );

  // --------------------------------------------------------------------------
  // 2. ADMIN → GEBRUIK TWIST NAMENS SPELER
  // --------------------------------------------------------------------------
  adminSocket.on(
    "admin:useTwist",
    async (
      payload: { username: string; twist: string; target?: string },
      ack: Function
    ) => {
      try {
        const { username, twist, target } = payload;

        const t = findTwistByAlias(twist.toLowerCase());
        if (!t) {
          return ack({
            success: false,
            message: `Twist '${twist}' bestaat niet.`,
          });
        }

        const user = await findUserByUsername(username);
        if (!user) {
          return ack({
            success: false,
            message: `Gebruiker '${username}' niet gevonden.`,
          });
        }

        // Heeft user twist?
        const has = await userHasTwist(user.id, t);
        if (!has) {
          return ack({
            success: false,
            message: `@${user.username} heeft geen ${t} tegoed.`,
          });
        }

        // Consume twist
        await consumeTwistFromUser(user.id, t);

        await useTwist(
          user.id,
          user.display_name,
          t,
          target ? target.replace("@", "") : undefined
        );

        ack({
          success: true,
          message: `Twist '${t}' gebruikt door ${user.display_name}.`,
        });

        // Log
        io.emit("log", {
          type: "twist",
          timestamp: Date.now(),
          message: `ADMIN gebruikte ${t} namens ${user.display_name}` +
                   (target ? ` op ${target}` : ""),
        });
      } catch (e: any) {
        ack({ success: false, message: e.message });
      }
    }
  );

  // --------------------------------------------------------------------------
  // 3. ADMIN → GET INVENTORY
  // --------------------------------------------------------------------------
  adminSocket.on(
    "admin:getTwistInv",
    async (payload: { username: string }, ack: Function) => {
      try {
        const { username } = payload;

        const user = await findUserByUsername(username);
        if (!user) {
          return ack({
            success: false,
            inventory: null,
            message: `Gebruiker '${username}' niet gevonden.`,
          });
        }

        const inv = await getUserTwistInventory(user.id);

        return ack({
          success: true,
          inventory: inv,
          message: `Twist inventory van ${user.display_name}.`,
        });
      } catch (e: any) {
        return ack({
          success: false,
          inventory: null,
          message: e.message,
        });
      }
    }
  );
}
