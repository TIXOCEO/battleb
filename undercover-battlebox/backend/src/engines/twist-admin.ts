// ============================================================================
// twist-admin.ts — Admin Twist Controller v1.0
// ============================================================================
//
// Doelen:
//  - Admin kan twists toevoegen aan een gebruiker
//  - Admin kan twists gebruiken namens een gebruiker (!use via dashboard)
//  - Logging naar admin dashboard
//  - Validatie & veilige checks
//
// Afhankelijk van:
//  - twist-inventory
//  - twist-engine (useTwist)
//  - twist-definitions
//  - user-engine
//  - server (emitLog)
//
// ============================================================================

import { emitLog } from "../server";
import pool from "../db";

import {
  addTwistToUser,
  userHasTwist,
  getUserTwistInventory,
} from "./twist-inventory";

import { useTwist } from "./8-twist-engine";
import {
  TwistType,
  TWIST_MAP,
  findTwistByAlias,
} from "./twist-definitions";

import { getOrUpdateUser } from "./2-user-engine";


// --------------------------------------------------------------------------------------
// Helper: Zoek user op basis van @username
// --------------------------------------------------------------------------------------
async function findUserByUsername(usernameRaw: string) {
  const clean = usernameRaw.replace("@", "").toLowerCase().trim();

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
// ADMIN FUNCTION — GIVE TWIST TO USER
// ============================================================================

export async function adminGiveTwist(
  adminName: string,
  targetUsername: string,
  twistType: TwistType,
  amount: number = 1
) {
  const user = await findUserByUsername(targetUsername);
  if (!user) {
    return {
      success: false,
      message: `Gebruiker @${targetUsername} bestaat niet.`,
    };
  }

  await addTwistToUser(user.id, twistType, amount);

  emitLog({
    type: "twist",
    message: `ADMIN ${adminName} gaf ${amount}× ${TWIST_MAP[twistType].giftName} aan ${user.display_name}`,
  });

  return {
    success: true,
    message: `Twist toegevoegd aan ${user.display_name}`,
  };
}


// ============================================================================
// ADMIN FUNCTION — USE TWIST AS USER
// ============================================================================

export async function adminUseTwist(
  adminName: string,
  targetUsername: string,
  twistType: TwistType,
  targetVictim?: string
) {
  const user = await findUserByUsername(targetUsername);

  if (!user) {
    return {
      success: false,
      message: `Gebruiker @${targetUsername} bestaat niet.`,
    };
  }

  // Zorg dat user twist heeft, zo niet: admin forceert (automatisch +1 geven)
  const has = await userHasTwist(user.id, twistType);
  if (!has) {
    await addTwistToUser(user.id, twistType, 1);

    emitLog({
      type: "twist",
      message: `ADMIN ${adminName} forceerde 1× ${TWIST_MAP[twistType].giftName} voor ${user.display_name}`,
    });
  }

  // Voer de twist uit
  await useTwist(user.id, user.display_name, twistType, targetVictim);

  emitLog({
    type: "twist",
    message: `ADMIN ${adminName} gebruikte ${TWIST_MAP[twistType].giftName} namens ${user.display_name}`,
  });

  return {
    success: true,
    message: `Twist uitgevoerd namens ${user.display_name}`,
  };
}


// ============================================================================
// ADMIN FUNCTION — Get Inventory
// ============================================================================

export async function adminGetTwistInventory(username: string) {
  const user = await findUserByUsername(username);
  if (!user) {
    return {
      success: false,
      message: `Gebruiker niet gevonden.`,
    };
  }

  const inv = await getUserTwistInventory(user.id);

  return {
    success: true,
    user: user.display_name,
    twists: inv,
  };
}
