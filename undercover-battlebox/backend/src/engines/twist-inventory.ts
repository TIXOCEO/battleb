// ============================================================================
// twist-inventory.ts — Twist Inventory Engine v1.0
// ============================================================================
//
// Opslag & beheer van twist-tegoeden per gebruiker.
//Iedere twist wordt per gebruiker opgeslagen in tabel user_twists.
//
// Functies:
//  - addTwistToUser()
//  - removeTwistFromUser()
//  - userHasTwist()
//  - getUserTwistInventory()
//  - consumeTwist() → gebruikt twist + mikt 1 af
//
// ============================================================================

import pool from "../db";
import { TwistType } from "./twist-definitions";


// ----------------------------------------------------------------------------
// Helper – DB row to usable format
// ----------------------------------------------------------------------------
function normalizeRow(row: any) {
  return {
    twist: row.twist_type as TwistType,
    amount: Number(row.amount || 0),
  };
}


// ============================================================================
// GET INVENTORY
// ============================================================================

export async function getUserTwistInventory(userId: string) {
  const { rows } = await pool.query(
    `
      SELECT twist_type, amount
      FROM user_twists
      WHERE user_tiktok_id = $1
    `,
    [userId]
  );

  return rows.map(normalizeRow);
}


// ============================================================================
// CHECK IF USER HAS TWIST
// ============================================================================

export async function userHasTwist(
  userId: string,
  twist: TwistType
): Promise<boolean> {
  const { rows } = await pool.query(
    `
      SELECT amount
      FROM user_twists
      WHERE user_tiktok_id = $1
        AND twist_type = $2
      LIMIT 1
    `,
    [userId, twist]
  );

  return rows[0] && Number(rows[0].amount) > 0;
}


// ============================================================================
// ADD TWIST TAX (ADMIN OR GIFTER)
// ============================================================================

export async function addTwistToUser(
  userId: string,
  twist: TwistType,
  amount: number = 1
) {
  await pool.query(
    `
      INSERT INTO user_twists (user_tiktok_id, twist_type, amount)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_tiktok_id, twist_type)
      DO UPDATE SET amount = user_twists.amount + EXCLUDED.amount
    `,
    [userId, twist, amount]
  );
}


// ============================================================================
// REMOVE 1 FROM TWIST — ONLY WHEN USING
// ============================================================================

export async function consumeTwist(
  userId: string,
  twist: TwistType
): Promise<boolean> {
  const { rows } = await pool.query(
    `
      SELECT amount FROM user_twists
      WHERE user_tiktok_id = $1
        AND twist_type = $2
      LIMIT 1
    `,
    [userId, twist]
  );

  if (!rows[0] || Number(rows[0].amount) <= 0) {
    return false;
  }

  await pool.query(
    `
      UPDATE user_twists
      SET amount = amount - 1
      WHERE user_tiktok_id = $1
        AND twist_type = $2
    `,
    [userId, twist]
  );

  return true;
}


// ============================================================================
// RESET ALL TWISTS FOR GAME END — OPTIONAL
// ============================================================================

export async function resetAllTwistsForGame() {
  await pool.query(`DELETE FROM user_twists`);
}

