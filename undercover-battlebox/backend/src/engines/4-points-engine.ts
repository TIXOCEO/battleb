// src/engines/4-points-engine.ts
import pool from '../db';

export async function addDiamonds(userId: bigint, amount: number, type: 'current_round' | 'stream' | 'total') {
  const column = type === 'current_round' ? 'diamonds_current_round' :
                 type === 'stream' ? 'diamonds_stream' : 'diamonds_total';

  await pool.query(
    `UPDATE users SET ${column} = ${column} + $1 WHERE tiktok_id = $2`,
    [amount, userId]
  );
}

export async function addBP(userId: bigint, amount: number, reason: string, displayName: string) {
  const { rows } = await pool.query(
    'SELECT multiplier, bp_total FROM users WHERE tiktok_id = $1',
    [userId]
  );

  const multiplier = rows[0]?.multiplier || 1;
  const currentBP = rows[0]?.bp_total || 0;
  const finalAmount = amount * multiplier;
  const newTotal = currentBP + finalAmount;

  await pool.query(
    `UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2`,
    [finalAmount, userId]
  );

  console.log(`[BP +${finalAmount.toFixed(1)} → ${newTotal.toFixed(1)} BP] (${reason}) → ${displayName}`);
}
