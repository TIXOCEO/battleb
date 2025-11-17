import pool from "../db";
import { TwistType, TWIST_MAP } from "./twist-definitions";

export type TwistInventory = Record<TwistType, number>;

/**
 * Zorgt ervoor dat twists altijd bestaan in JSON.
 */
export function normalizeTwists(raw: any): TwistInventory {
  const clean: TwistInventory = {
    galaxy: 0,
    moneygun: 0,
    immune: 0,
    diamond_pistol: 0,
    bomb: 0,
    heal: 0,
  };

  if (!raw || typeof raw !== "object") return clean;

  for (const key of Object.keys(clean)) {
    const t = key as TwistType;
    clean[t] = Number(raw[t] ?? 0);
  }

  return clean;
}

/**
 * Haal inventory van gebruiker op.
 */
export async function getTwistInventory(userId: bigint): Promise<TwistInventory> {
  const r = await pool.query(
    `SELECT twists FROM users WHERE tiktok_id=$1`,
    [userId]
  );

  if (!r.rows[0]) return normalizeTwists({});
  return normalizeTwists(r.rows[0].twists);
}

/**
 * Voeg 1 of meer twists toe.
 */
export async function addTwistToUser(
  userId: bigint,
  twist: TwistType,
  quantity = 1
) {
  const inv = await getTwistInventory(userId);
  inv[twist] = (inv[twist] || 0) + quantity;

  await pool.query(
    `UPDATE users SET twists=$1 WHERE tiktok_id=$2`,
    [inv, userId]
  );

  return inv;
}

/**
 * Verbruik (consumeer) 1 twist.
 */
export async function consumeTwist(
  userId: bigint,
  twist: TwistType
): Promise<boolean> {
  const inv = await getTwistInventory(userId);

  if ((inv[twist] || 0) <= 0) return false;

  inv[twist] = inv[twist] - 1;

  await pool.query(
    `UPDATE users SET twists=$1 WHERE tiktok_id=$2`,
    [inv, userId]
  );

  return true;
}

/**
 * Check of user twist bezit.
 */
export async function hasTwist(
  userId: bigint,
  twist: TwistType
): Promise<boolean> {
  const inv = await getTwistInventory(userId);
  return (inv[twist] || 0) > 0;
}

/**
 * Verwijdert ALLE twist te goeden van ALLE users — wordt gebruikt
 * na het beëindigen van een game.
 */
export async function clearAllTwists() {
  await pool.query(`UPDATE users SET twists='{}'::jsonb`);
}
