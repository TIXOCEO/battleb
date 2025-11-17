// ============================================================================
// twist-inventory.ts — v1.1 (Build-Safe)
// ============================================================================
// Bewaart welke twists elke gebruiker bezit.
// ============================================================================

import pool from "../db";
import type { TwistType } from "./twist-definitions";

// ============================================================================
// INIT
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
// GIVE TWIST
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
// CONSUME TWIST (1 stuk)
// ============================================================================
export async function consumeTwistFromUser(
  userId: string,
  twist: TwistType
): Promise<boolean> {
  const res = await pool.query(
    `
    DELETE FROM twist_inventory
    WHERE id = (
      SELECT id FROM twist_inventory
      WHERE user_id = $1 AND twist_type = $2
      ORDER BY id ASC
      LIMIT 1
    )
    RETURNING id
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
export async function clearTwistsForUser(
  userId: string
) {
  await pool.query(
    `
    DELETE FROM twist_inventory
    WHERE user_id = $1
    `,
    [userId]
  );
}
