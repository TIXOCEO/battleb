// ============================================================================
// twist-inventory.ts — v1.0
// Slaat twist-tegoeden per gebruiker op in de database.
//
// Database-vereiste:
//  In tabel "users" moet een kolom "blocks" bestaan (jsonb)
//  Dit veld gebruiken we nu als "twists inventory".
//
// Structuur in DB:
//   blocks: {
//      twists: {
//         moneygun: number,
//         galaxy: number,
//         diamond_pistol: number,
//         immune: number,
//         bomb: number,
//         heal: number
//      }
//   }
//
// ============================================================================

import pool from "../db";
import type { TwistType } from "./twist-definitions";

// ----------------------------------------------------------------------------------
// Helper: zorg dat blocks.twists bestaat in de user row
// ----------------------------------------------------------------------------------
function normalizeTwistInventory(row: any): Record<TwistType, number> {
  const twists =
    row?.blocks?.twists ??
    {
      galaxy: 0,
      moneygun: 0,
      immune: 0,
      diamond_pistol: 0,
      bomb: 0,
      heal: 0,
    };

  return {
    galaxy: twists.galaxy ?? 0,
    moneygun: twists.moneygun ?? 0,
    immune: twists.immune ?? 0,
    diamond_pistol: twists.diamond_pistol ?? 0,
    bomb: twists.bomb ?? 0,
    heal: twists.heal ?? 0,
  };
}

// ----------------------------------------------------------------------------------
//  GET INVENTORY
// ----------------------------------------------------------------------------------
export async function getUserTwistInventory(
  tiktokId: string
): Promise<Record<TwistType, number>> {
  const tid = BigInt(tiktokId);

  const { rows } = await pool.query(
    `
    SELECT blocks
    FROM users
    WHERE tiktok_id=$1
    LIMIT 1
    `,
    [tid]
  );

  if (!rows[0]) {
    return {
      galaxy: 0,
      moneygun: 0,
      immune: 0,
      diamond_pistol: 0,
      bomb: 0,
      heal: 0,
    };
  }

  return normalizeTwistInventory(rows[0]);
}

// ----------------------------------------------------------------------------------
//  ADD TWIST (gift aankoop of admin)
// ----------------------------------------------------------------------------------
export async function addTwistToUser(
  tiktokId: string,
  type: TwistType,
  amount: number = 1
) {
  const tid = BigInt(tiktokId);

  // Haal huidige inventory op
  const inv = await getUserTwistInventory(tiktokId);
  inv[type] = (inv[type] ?? 0) + amount;

  // Update DB
  await pool.query(
    `
    UPDATE users
    SET blocks = jsonb_set(
      COALESCE(blocks, '{}'::jsonb),
      '{twists}',
      $1::jsonb
    )
    WHERE tiktok_id=$2
    `,
    [JSON.stringify(inv), tid]
  );
}

// ----------------------------------------------------------------------------------
//  CONSUME TWIST (bij !use of admin)
// ----------------------------------------------------------------------------------
export async function consumeTwistFromUser(
  tiktokId: string,
  type: TwistType
): Promise<boolean> {
  const inv = await getUserTwistInventory(tiktokId);

  if ((inv[type] ?? 0) <= 0) return false;

  inv[type] -= 1;

  await pool.query(
    `
    UPDATE users
    SET blocks = jsonb_set(
      COALESCE(blocks, '{}'::jsonb),
      '{twists}',
      $1::jsonb
    )
    WHERE tiktok_id=$2
    `,
    [JSON.stringify(inv), BigInt(tiktokId)]
  );

  return true;
}

// ----------------------------------------------------------------------------------
//  CHECK OWNERSHIP
// ----------------------------------------------------------------------------------
export async function userHasTwist(
  tiktokId: string,
  type: TwistType
): Promise<boolean> {
  const inv = await getUserTwistInventory(tiktokId);
  return (inv[type] ?? 0) > 0;
}

// ----------------------------------------------------------------------------------
//  CLEAR ALL TWISTS (end of game)
// ----------------------------------------------------------------------------------
export async function clearAllTwistsForUser(tiktokId: string) {
  await pool.query(
    `
    UPDATE users
    SET blocks = jsonb_set(
      COALESCE(blocks, '{}'::jsonb),
      '{twists}',
      '{"galaxy":0,"moneygun":0,"immune":0,"diamond_pistol":0,"bomb":0,"heal":0}'::jsonb
    )
    WHERE tiktok_id=$1
    `,
    [BigInt(tiktokId)]
  );
}

// ----------------------------------------------------------------------------------
//  CLEAR INVENTORIES FOR ALL USERS (reset after game end)
// ----------------------------------------------------------------------------------
export async function clearTwistsForAllUsers() {
  await pool.query(
    `
    UPDATE users
    SET blocks = jsonb_set(
      COALESCE(blocks, '{}'::jsonb),
      '{twists}',
      '{"galaxy":0,"moneygun":0,"immune":0,"diamond_pistol":0,"bomb":0,"heal":0}'
    )
    `
  );
}
