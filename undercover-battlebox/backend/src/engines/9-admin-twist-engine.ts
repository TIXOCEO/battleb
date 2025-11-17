// ============================================================================
// 9-admin-twist-engine.ts — Admin Twist Engine (dashboard control)
// ============================================================================
//
// Admin kan:
//   • Give twist to user
//   • Use twist (zelfde als !use)
//   • List inventory
//
// ============================================================================

import {
  giveTwistToUser,
  consumeTwistFromUser,
  listTwistsForUser,
} from "./twist-inventory";

import {
  TWIST_MAP,
  TwistType,
  resolveTwistAlias,
} from "./twist-definitions";

import { useTwist } from "./8-twist-engine";
import pool from "../db";

// ============================================================================
// HELPER: zoek user
// ============================================================================

async function findUser(raw: string) {
  const clean = raw.replace("@", "").toLowerCase();

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
// ADMIN → GIVE TWIST
// ============================================================================

export async function adminGiveTwist(
  requester: string,
  targetUsername: string,
  twist: TwistType
) {
  const u = await findUser(targetUsername);
  if (!u) throw new Error("Gebruiker bestaat niet");

  await giveTwistToUser(u.id, twist);

  return {
    success: true,
    message: `Twist '${TWIST_MAP[twist].giftName}' toegevoegd aan ${u.display_name}`,
  };
}

// ============================================================================
// ADMIN → USE TWIST
// ============================================================================

export async function adminUseTwist(
  requester: string,
  username: string,
  twist: TwistType,
  target?: string
) {
  const u = await findUser(username);
  if (!u) throw new Error("Gebruiker bestaat niet");

  await useTwist(u.id, u.display_name, twist, target);

  return { success: true };
}

// ============================================================================
// ADMIN → INVENTORY
// ============================================================================

export async function adminListTwists(username: string) {
  const u = await findUser(username);
  if (!u) throw new Error("Gebruiker bestaat niet");

  const list = await listTwistsForUser(u.id);

  return {
    user: u,
    twists: list.map(t => TWIST_MAP[t].giftName),
  };
}
