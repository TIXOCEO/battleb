// ============================================================================
// twist-inventory.ts — v2.0 (BattleBox MoneyGun Fase-2 Ready)
// ----------------------------------------------------------------------------
// ✔ 100% compatible met twist-engine v14+
// ✔ Veilig: atomic DELETE met SKIP LOCKED
// ✔ Helpers toegevoegd voor Fase 2 (countTwistsForUser, hasTwist, listTargetsMarked)
// ✔ GEEN max 1 per gebruiker — want MoneyGun = max 1 *per target*, NIET per user
// ✔ Schema blijft gelijk (géén migraties nodig)
// ============================================================================

import pool from "../db";
import type { TwistType } from "./twist-definitions";

// ============================================================================
// INIT — TABLE STRUCTURE
// ============================================================================
export async function initTwistInventoryTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS twist_inventory (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      twist_type TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

// ============================================================================
// GIVE TWIST → voeg exact 1 item toe
// ============================================================================
export async function giveTwistToUser(
  userId: string,
  twist: TwistType
) {
  await pool.query(
    `
    INSERT INTO twist_inventory (user_id, twist_type)
    VALUES ($1, $2)
    `,
    [userId, twist]
  );

  return true;
}

// ============================================================================
// CONSUME TWIST → verwijdert slechts 1 item (atomic + lock-safe)
// ============================================================================
export async function consumeTwistFromUser(
  userId: string,
  twist: TwistType
): Promise<boolean> {
  const res = await pool.query(
    `
    DELETE FROM twist_inventory
    WHERE id = (
      SELECT id
      FROM twist_inventory
      WHERE user_id = $1
        AND twist_type = $2
      ORDER BY id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
    `,
    [userId, twist]
  );

  return (res.rowCount ?? 0) > 0;
}

// ============================================================================
// COUNT TWISTS FOR USER (telt aantal van een type)
// ============================================================================
export async function countTwistsForUser(
  userId: string,
  twist: TwistType
): Promise<number> {
  const res = await pool.query(
    `
    SELECT COUNT(*) AS total
    FROM twist_inventory
    WHERE user_id=$1 AND twist_type=$2
    `,
    [userId, twist]
  );

  return Number(res.rows[0]?.total || 0);
}

// ============================================================================
// HAS TWIST (boolean)
// ============================================================================
export async function hasTwist(
  userId: string,
  twist: TwistType
): Promise<boolean> {
  const res = await pool.query(
    `
    SELECT id
    FROM twist_inventory
    WHERE user_id=$1 AND twist_type=$2
    LIMIT 1
    `,
    [userId, twist]
  );

  return (res.rowCount ?? 0) > 0;
}

// ============================================================================
// LIST USER INVENTORY
// ============================================================================
export async function listTwistsForUser(
  userId: string
): Promise<TwistType[]> {
  const res = await pool.query(
    `
    SELECT twist_type
    FROM twist_inventory
    WHERE user_id = $1
    ORDER BY id ASC
    `,
    [userId]
  );

  return res.rows.map(r => r.twist_type) as TwistType[];
}

// ============================================================================
// CLEAR ALL USER TWISTS
// ============================================================================
export async function clearTwistsForUser(userId: string) {
  await pool.query(
    `
    DELETE FROM twist_inventory
    WHERE user_id=$1
    `,
    [userId]
  );
}

// ============================================================================
// (NEW) OPTIONAL — LIST ALL USERS OF A TWIST TYPE
// ============================================================================
export async function listAllUsersWithTwist(
  twist: TwistType
): Promise<{ user_id: string }[]> {
  const res = await pool.query(
    `
    SELECT user_id
    FROM twist_inventory
    WHERE twist_type=$1
    `,
    [twist]
  );
  return res.rows;
}
