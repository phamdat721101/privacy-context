/**
 * paidCallLedger — single insertion point for /api/v1 settlement records.
 *
 * SOLID:
 *   - SRP: this module owns writes to the `paid_calls` table. Nothing else.
 *   - DIP: x402 path AND fherc20 path both call `record()`; neither knows about the other.
 *
 * Idempotent on (network, tx_hash) — re-submitting the same proof is a no-op.
 */

import { pool } from '../db';
import { logger } from '../lib';

export interface PaidCallRecord {
  agentId: string;
  slug: string;
  buyer: string;
  amountUsdc: string;          // decimal string, e.g. "0.01"
  txHash: string;
  network: string;             // 'arbitrum-sepolia' | 'base-sepolia' | …
  method: 'exact' | 'fherc20' | 'demo'; // x402 / FHERC20 confidential / free try-it (PRD-2)
}

/** Returns true if a fresh row was inserted, false if it was a duplicate. */
export async function record(call: PaidCallRecord): Promise<boolean> {
  const r = await pool.query(
    `INSERT INTO paid_calls (agent_id, slug, buyer, amount_usdc, tx_hash, network, method)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (network, tx_hash) DO NOTHING
     RETURNING id`,
    [call.agentId, call.slug, call.buyer.toLowerCase(), call.amountUsdc, call.txHash, call.network, call.method],
  );
  const fresh = (r.rowCount ?? 0) > 0;
  if (fresh) {
    logger.info({ slug: call.slug, txHash: call.txHash, method: call.method }, 'paidCall:recorded');
  } else {
    logger.debug({ txHash: call.txHash }, 'paidCall:duplicate');
  }
  return fresh;
}

/** Today's call count for a slug — used by daily_request_cap rate limiter. */
export async function countToday(slug: string): Promise<number> {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c FROM paid_calls
      WHERE slug = $1 AND created_at >= NOW() - INTERVAL '1 day'`,
    [slug],
  );
  return r.rows[0]?.c ?? 0;
}
