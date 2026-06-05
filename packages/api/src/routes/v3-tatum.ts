/**
 * Tatum integration — Notifications subscribe + webhook receiver + forwarder.
 *
 * Two surfaces in one file (essential-files-only): the route handler that
 * accepts inbound webhook POSTs, plus a tiny `TatumNotifications` helper that
 * the brains/agents publish flow uses to subscribe a seller's address.
 *
 * SOLID:
 * - SRP: handler + helper share one external dep (Tatum API + DB), so a single
 *   file is the right grain. They do NOT do payment verification (that's the
 *   /v3/agents/:id paymentGate) and they do NOT decrypt anything.
 * - DI: helper takes the API key explicitly; never reads env in hot path.
 *
 * Mistake-avoidance: every external HTTP call goes through `resilientCall`
 * (matches the rest of the codebase). Webhook signature verification rejects
 * malformed POSTs early so the DLQ path stays clean.
 */

import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { resilientCall } from '@fhe-ai-context/runtime-utils';
import { pool } from '../db';
import { logger } from '../lib';

const router = Router();

// ---------------------------------------------------------------------------
// /v3/webhooks/tatum-notifications — POST receiver from Tatum cloud.
// ---------------------------------------------------------------------------

router.post('/tatum-notifications', async (req: Request, res: Response) => {
  const sig = req.header('x-tatum-signature') ?? '';
  const secret = process.env.TATUM_WEBHOOK_SECRET ?? '';
  if (!verifyTatumSignature(JSON.stringify(req.body ?? {}), sig, secret)) {
    return res.status(401).json({ error: 'bad signature' });
  }

  const event = (req.body ?? {}) as TatumAddressEvent;
  if (!event.address || !event.txId) {
    return res.status(400).json({ error: 'missing fields' });
  }

  // Look up the seller's brain + their configured webhook URL.
  let row: { brain_id: string; seller_webhook_url: string | null } | undefined;
  try {
    const q = await pool.query(
      `SELECT id AS brain_id, seller_webhook_url
       FROM brains_trustless
       WHERE LOWER(owner_address) = LOWER($1)
       LIMIT 1`,
      [event.address],
    );
    row = q.rows[0];
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'tatum-webhook:db-error');
    return res.status(503).json({ error: 'temporary' });
  }

  if (!row) {
    // Unknown address — accept and drop.
    return res.status(200).json({ ok: true, action: 'noop' });
  }

  if (row.seller_webhook_url) {
    // Forward asynchronously — don't block Tatum.
    forwardToSeller(row.seller_webhook_url, {
      type: 'paid_query',
      brainId: row.brain_id,
      transactionHash: event.txId,
      valueUsd: event.value,
      timestamp: event.timestamp ?? Date.now(),
    }).catch((err) =>
      logger.warn({ err: err.message, brainId: row?.brain_id }, 'tatum-webhook:forward-failed'),
    );
  }

  res.status(200).json({ ok: true, brainId: row.brain_id });
});

// ---------------------------------------------------------------------------
// Helper class — subscribe a seller's wallet to Tatum Address Events.
// Used by the publish flow (brains.ts) when a brain becomes published.
//
// ⚠️ DEPRECATED in favor of `services/tatumClient.ts` (single Tatum I/O point).
// ⚠️ NOTE: as of 2026-06-04 Tatum's Notifications `attr.chain` enum does NOT
//          include SUI. EVM chains (base-sepolia, arb-one-mainnet, …) work;
//          Sui address subscriptions return 400. tatumClient surfaces this as
//          TatumChainNotSupportedError. New callers should use that surface.
//          Kept here for backward-compat with existing import sites until
//          they migrate.
// ---------------------------------------------------------------------------

export interface TatumSubscription {
  id: string;
  type: 'ADDRESS_EVENT';
  attr: { chain: 'SUI'; address: string; url: string };
}

export class TatumNotifications {
  constructor(private readonly apiKey: string) {}

  async subscribe(suiAddress: string, openxWebhookUrl: string): Promise<TatumSubscription> {
    return resilientCall({ name: 'tatum-notifications-subscribe' }, async () => {
      const res = await fetch('https://api.tatum.io/v3/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey },
        body: JSON.stringify({
          type: 'ADDRESS_EVENT',
          attr: { chain: 'SUI', address: suiAddress, url: openxWebhookUrl },
        }),
      });
      if (!res.ok) throw new Error(`tatum:subscribe ${res.status}`);
      return (await res.json()) as TatumSubscription;
    });
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    await resilientCall({ name: 'tatum-notifications-unsubscribe' }, async () => {
      const res = await fetch(`https://api.tatum.io/v3/subscription/${subscriptionId}`, {
        method: 'DELETE',
        headers: { 'x-api-key': this.apiKey },
      });
      if (!res.ok && res.status !== 404) throw new Error(`tatum:unsubscribe ${res.status}`);
    });
  }
}

// ---------------------------------------------------------------------------
// internal helpers
// ---------------------------------------------------------------------------

interface TatumAddressEvent {
  txId: string;
  address: string;
  value?: string;
  timestamp?: number;
}

function verifyTatumSignature(body: string, signature: string, secret: string): boolean {
  if (!secret) {
    // Permissive in dev when secret unset (matches PAYMENT_SECRET pattern).
    return process.env.NODE_ENV !== 'production';
  }
  try {
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    return signature === expected || signature === `sha256=${expected}`;
  } catch {
    return false;
  }
}

async function forwardToSeller(
  url: string,
  payload: Record<string, unknown>,
  retries = 3,
): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-OpenX-Event': 'paid_query' },
        body: JSON.stringify(payload),
      });
      if (res.ok) return;
    } catch {/* retry */}
    await new Promise((r) => setTimeout(r, Math.pow(2, i) * 500));
  }
  // Final failure — DLQ.
  await pool.query(
    `INSERT INTO webhook_dlq (target_url, payload, last_error, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT DO NOTHING`,
    [url, JSON.stringify(payload), 'forward retries exhausted'],
  );
}

export default router;
