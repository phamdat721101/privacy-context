/**
 * webhook-retry — drains scheduled webhook redeliveries every WEBHOOK_TICK_MS.
 *
 * Reuses the SQL contract owned by asyncTaskService (status, next_retry_at,
 * attempt_count, expires_at). This file deliberately re-implements the
 * delivery loop inline (instead of importing from packages/api) to avoid a
 * cross-package runtime dependency — the worker stays self-contained.
 *
 * SOLID:
 *   • SRP — one job: send pending deliveries.
 *   • OCP — backoff schedule is a const array; tweak without code change.
 */

import 'dotenv/config';
import { createHmac } from 'node:crypto';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : undefined,
});

const TICK_MS = Math.max(5_000, Number(process.env.OPENX_WEBHOOK_TICK_MS ?? 30_000));
const ATTEMPT_TIMEOUT_MS = Math.max(1_000, Number(process.env.OPENX_WEBHOOK_TIMEOUT_MS ?? 30_000));
const BATCH = Math.max(1, Number(process.env.OPENX_WEBHOOK_BATCH ?? 50));
const MAX_RETRIES = 7;
const RETRY_SCHEDULE_SEC = [1, 5, 30, 120, 600, 3600, 14400, 86400];
const WEBHOOK_SECRET = process.env.OPENX_WEBHOOK_SECRET ?? 'dev-only-webhook-secret-please-rotate';

interface DeliveryRow {
  id: string;
  destination_url: string;
  payload: any;
  idempotency_key: string;
  hmac_signature: string;
  attempt_count: number;
}

async function attemptOnce(row: DeliveryRow): Promise<{
  ok: boolean;
  terminal?: boolean;
  status?: number;
  body?: string;
}> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    const body = typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload);
    // Recompute HMAC to verify on-the-wire signature stays canonical.
    const sig = row.hmac_signature || createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
    const res = await fetch(row.destination_url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-openx-delivery-id': row.idempotency_key,
        'x-openx-signature': sig,
      },
      body,
      signal: ac.signal,
    });
    if (res.ok) return { ok: true, status: res.status };
    if (res.status >= 400 && res.status < 500) {
      return { ok: false, terminal: true, status: res.status, body: await res.text().catch(() => '') };
    }
    return { ok: false, status: res.status, body: await res.text().catch(() => '') };
  } catch (err) {
    return { ok: false, body: (err as Error).message ?? 'network', status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

async function runOnce(): Promise<{ checked: number; delivered: number; retried: number; dead: number }> {
  const due = await pool.query<DeliveryRow>(
    `SELECT id, destination_url, payload, idempotency_key, hmac_signature, attempt_count
       FROM agent_webhook_deliveries
      WHERE status = 'pending'
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
        AND expires_at > NOW()
   ORDER BY next_retry_at NULLS FIRST
      LIMIT $1`,
    [BATCH],
  );

  let delivered = 0;
  let retried = 0;
  let dead = 0;

  for (const row of due.rows) {
    const result = await attemptOnce(row);
    if (result.ok) {
      await pool.query(
        `UPDATE agent_webhook_deliveries
            SET status = 'delivered',
                last_response_code = $2,
                attempt_count = attempt_count + 1
          WHERE id = $1`,
        [row.id, result.status ?? 200],
      );
      delivered++;
    } else if (result.terminal) {
      await pool.query(
        `UPDATE agent_webhook_deliveries
            SET status = 'failed',
                last_response_code = $2,
                last_response_body = $3,
                attempt_count = attempt_count + 1
          WHERE id = $1`,
        [row.id, result.status ?? 0, (result.body ?? '').slice(0, 1000)],
      );
      dead++;
    } else {
      const next = row.attempt_count + 1;
      if (next >= MAX_RETRIES) {
        await pool.query(
          `UPDATE agent_webhook_deliveries
              SET status = 'dead_letter',
                  last_response_code = $2,
                  last_response_body = $3,
                  attempt_count = $4
            WHERE id = $1`,
          [row.id, result.status ?? 0, (result.body ?? '').slice(0, 1000), next],
        );
        dead++;
      } else {
        const delay = RETRY_SCHEDULE_SEC[Math.min(next, RETRY_SCHEDULE_SEC.length - 1)];
        await pool.query(
          `UPDATE agent_webhook_deliveries
              SET status = 'pending',
                  last_response_code = $2,
                  last_response_body = $3,
                  attempt_count = $4,
                  next_retry_at = NOW() + ($5 || ' seconds')::interval
            WHERE id = $1`,
          [row.id, result.status ?? 0, (result.body ?? '').slice(0, 1000), next, String(delay)],
        );
        retried++;
      }
    }
  }
  return { checked: due.rowCount ?? 0, delivered, retried, dead };
}

export function startWebhookRetry(): void {
  if (process.env.FEATURE_BUYER_AGENT_COMM !== 'true') {
    console.log('[webhook-retry] disabled (FEATURE_BUYER_AGENT_COMM not true)');
    return;
  }
  console.log(`[webhook-retry] starting, tick=${TICK_MS}ms batch=${BATCH}`);
  const tick = async () => {
    try {
      const s = await runOnce();
      if (s.checked > 0) {
        console.log(
          `[webhook-retry] checked=${s.checked} delivered=${s.delivered} retried=${s.retried} dead=${s.dead}`,
        );
      }
    } catch (err) {
      console.error('[webhook-retry] tick failed', (err as Error).message);
    }
  };
  setTimeout(tick, 5_000);
  setInterval(tick, TICK_MS);
}
