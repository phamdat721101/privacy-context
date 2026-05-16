import { pool } from '../db';
import { getCofheClient } from './client';

export async function importPermit(userAddress: string, serializedPermit: string): Promise<void> {
  // Try to verify with CoFHE SDK; store regardless to survive SDK issues
  try {
    const client = await getCofheClient();
    await client.permits.importShared(serializedPermit);
  } catch {}
  await pool.query(
    `INSERT INTO permits (user_address, serialized_permit) VALUES ($1, $2)
     ON CONFLICT (user_address) DO UPDATE SET serialized_permit = $2, created_at = NOW()`,
    [userAddress.toLowerCase(), serializedPermit]
  );
}

export async function revokePermit(userAddress: string): Promise<void> {
  await pool.query(`DELETE FROM permits WHERE user_address = $1`, [userAddress.toLowerCase()]);
}

export async function hasPermit(userAddress: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM permits WHERE user_address = $1 LIMIT 1`,
    [userAddress.toLowerCase()]
  );
  return rows.length > 0;
}

export async function getPermit(userAddress: string): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT serialized_permit FROM permits WHERE user_address = $1 LIMIT 1`,
    [userAddress.toLowerCase()]
  );
  return rows[0]?.serialized_permit || null;
}
