/**
 * asyncTaskService — M3 long-running task primitive.
 *
 * Tasks are created from the /api/v1/<slug> paywall when the buyer asks
 * `async: true`. They are picked up by the in-process runner (started from
 * server.ts) and delivered via webhook with exponential backoff + HMAC
 * signature + idempotency key + DLQ.
 *
 * SOLID:
 *   • SRP — task lifecycle + webhook delivery.
 *   • OCP — backoff schedule is a const array; tweak without code change.
 *   • DIP — exported as IAsyncTaskService; webhook target is just a URL.
 */

import { createHash, createHmac } from 'node:crypto';
import { pool } from '../db';
import { logger } from '../lib';

// ─── types ─────────────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'running' | 'complete' | 'failed';
export type WebhookStatus = 'pending' | 'delivered' | 'failed' | 'dead_letter';

export interface TaskRow {
  id: string;
  agent_id: string;
  slug: string | null;
  thread_id: string | null;
  buyer_wallet: string;
  payload: any;
  webhook_url: string | null;
  status: TaskStatus;
  result: any;
  tee_attestation_hash: string | null;
  paid_call_id: string | null;
  estimated_completion_at: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface IAsyncTaskService {
  createTask(input: {
    agent_id: string;
    slug?: string;
    buyer_wallet: string;
    payload: any;
    webhook_url?: string;
    thread_id?: string;
    paid_call_id?: string;
    estimated_seconds?: number;
  }): Promise<TaskRow>;
  getTask(task_id: string): Promise<TaskRow | null>;
  claimNextPending(): Promise<TaskRow | null>;
  completeTask(task_id: string, result: any, attestation_hash?: string): Promise<void>;
  failTask(task_id: string, error: string): Promise<void>;
  scheduleWebhook(task_id: string, payload: any): Promise<void>;
  scheduleNotification(destination_url: string, payload: any, event_key: string): Promise<void>;
  deliverDueWebhooks(batch?: number): Promise<{ checked: number; delivered: number; retried: number; dead: number }>;
}

// ─── config ────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = process.env.OPENX_WEBHOOK_SECRET ?? 'dev-only-webhook-secret-please-rotate';
const ATTEMPT_TIMEOUT_MS = Math.max(1000, Number(process.env.OPENX_WEBHOOK_TIMEOUT_MS ?? 30_000));
const RETENTION_DAYS = Math.max(1, Number(process.env.OPENX_WEBHOOK_RETENTION_DAYS ?? 7));
const MAX_RETRIES = 7;
// Exponential schedule in seconds: 1, 5, 30, 120, 600, 3600, 14400, 86400
const RETRY_SCHEDULE_SEC = [1, 5, 30, 120, 600, 3600, 14400, 86400];

// ─── implementation ────────────────────────────────────────────────────────

class AsyncTaskService implements IAsyncTaskService {
  async createTask(input: {
    agent_id: string;
    slug?: string;
    buyer_wallet: string;
    payload: any;
    webhook_url?: string;
    thread_id?: string;
    paid_call_id?: string;
    estimated_seconds?: number;
  }): Promise<TaskRow> {
    const est = input.estimated_seconds
      ? new Date(Date.now() + input.estimated_seconds * 1000)
      : null;
    const r = await pool.query<TaskRow>(
      `INSERT INTO agent_tasks
         (agent_id, slug, thread_id, buyer_wallet, payload, webhook_url,
          status, paid_call_id, estimated_completion_at)
       VALUES ($1, $2, $3, LOWER($4), $5::jsonb, $6, 'pending', $7, $8)
       RETURNING *`,
      [
        input.agent_id,
        input.slug ?? null,
        input.thread_id ?? null,
        input.buyer_wallet,
        JSON.stringify(input.payload ?? {}),
        input.webhook_url ?? null,
        input.paid_call_id ?? null,
        est,
      ],
    );
    logger.info({ task_id: r.rows[0].id, agent_id: input.agent_id }, 'task:created');
    return r.rows[0];
  }

  async getTask(task_id: string): Promise<TaskRow | null> {
    // agent_tasks.id is BIGSERIAL — reject anything non-numeric up front
    // to avoid a Postgres "invalid input syntax for type bigint" crash.
    if (!/^\d+$/.test(String(task_id))) return null;
    const r = await pool.query<TaskRow>(`SELECT * FROM agent_tasks WHERE id = $1 LIMIT 1`, [task_id]);
    return r.rows[0] ?? null;
  }

  // Atomic claim: UPDATE ... RETURNING ensures exactly one worker processes
  // each task even when several runners poll concurrently.
  async claimNextPending(): Promise<TaskRow | null> {
    const r = await pool.query<TaskRow>(
      `UPDATE agent_tasks
          SET status = 'running', started_at = NOW()
        WHERE id = (
          SELECT id FROM agent_tasks
           WHERE status = 'pending'
        ORDER BY created_at
           LIMIT 1
             FOR UPDATE SKIP LOCKED
        )
        RETURNING *`,
    );
    return r.rows[0] ?? null;
  }

  async completeTask(task_id: string, result: any, attestation_hash?: string): Promise<void> {
    await pool.query(
      `UPDATE agent_tasks
          SET status = 'complete',
              result = $2::jsonb,
              tee_attestation_hash = COALESCE($3, tee_attestation_hash),
              completed_at = NOW()
        WHERE id = $1`,
      [task_id, JSON.stringify(result ?? null), attestation_hash ?? null],
    );
    // Schedule the webhook delivery (if a URL was provided).
    const t = await this.getTask(task_id);
    if (t?.webhook_url) {
      await this.scheduleWebhook(task_id, {
        task_id,
        status: 'complete',
        result,
        tee_attestation_hash: attestation_hash ?? t.tee_attestation_hash,
        paid_call_id: t.paid_call_id,
      });
    }
    logger.info({ task_id }, 'task:complete');
  }

  async failTask(task_id: string, error: string): Promise<void> {
    await pool.query(
      `UPDATE agent_tasks
          SET status = 'failed',
              error_message = $2,
              completed_at = NOW()
        WHERE id = $1`,
      [task_id, error.slice(0, 1000)],
    );
    const t = await this.getTask(task_id);
    if (t?.webhook_url) {
      await this.scheduleWebhook(task_id, {
        task_id,
        status: 'failed',
        error,
      });
    }
    logger.warn({ task_id, error: error.slice(0, 200) }, 'task:failed');
  }

  async scheduleWebhook(task_id: string, payload: any): Promise<void> {
    const t = await this.getTask(task_id);
    if (!t?.webhook_url) return;

    const body = JSON.stringify(payload);
    const idempotency_key =
      createHash('sha256').update(body + task_id + Date.now()).digest('hex').slice(0, 64);
    const hmac = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

    await pool.query(
      `INSERT INTO agent_webhook_deliveries
         (task_id, destination_url, payload, idempotency_key, hmac_signature,
          status, next_retry_at, expires_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, 'pending', NOW(), NOW() + ($6 || ' days')::interval)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [task_id, t.webhook_url, body, idempotency_key, hmac, String(RETENTION_DAYS)],
    );
  }

  /**
   * Schedule a fire-and-forget notification delivery (no task lifecycle).
   * Inserts a row into agent_webhook_deliveries with task_id=NULL so the
   * worker's retry loop drains it via the same path as task webhooks.
   *
   * Idempotency key is keyed on the natural event id (caller-supplied) so
   * duplicate notifications collapse to a single delivery attempt — the
   * paidCallLedger uses paid_call_id, threadService uses message_id.
   */
  async scheduleNotification(
    destination_url: string,
    payload: any,
    event_key: string,
  ): Promise<void> {
    if (!destination_url) return;
    const body = JSON.stringify(payload);
    const idempotency_key = createHash('sha256').update(event_key).digest('hex').slice(0, 64);
    const hmac = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
    await pool.query(
      `INSERT INTO agent_webhook_deliveries
         (task_id, destination_url, payload, idempotency_key, hmac_signature,
          status, next_retry_at, expires_at)
       VALUES (NULL, $1, $2::jsonb, $3, $4, 'pending', NOW(), NOW() + ($5 || ' days')::interval)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [destination_url, body, idempotency_key, hmac, String(RETENTION_DAYS)],
    );
  }

  async deliverDueWebhooks(
    batch = 50,
  ): Promise<{ checked: number; delivered: number; retried: number; dead: number }> {
    const due = await pool.query<{
      id: string;
      destination_url: string;
      payload: any;
      idempotency_key: string;
      hmac_signature: string;
      attempt_count: number;
    }>(
      `SELECT id, destination_url, payload, idempotency_key, hmac_signature, attempt_count
         FROM agent_webhook_deliveries
        WHERE status = 'pending'
          AND (next_retry_at IS NULL OR next_retry_at <= NOW())
          AND expires_at > NOW()
     ORDER BY next_retry_at NULLS FIRST
        LIMIT $1`,
      [batch],
    );

    let delivered = 0;
    let retried = 0;
    let dead = 0;

    for (const row of due.rows) {
      const result = await attemptOnce(row.destination_url, row.payload, {
        idempotency_key: row.idempotency_key,
        hmac_signature: row.hmac_signature,
      });

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
        const nextAttempt = row.attempt_count + 1;
        if (nextAttempt >= MAX_RETRIES) {
          await pool.query(
            `UPDATE agent_webhook_deliveries
                SET status = 'dead_letter',
                    last_response_code = $2,
                    last_response_body = $3,
                    attempt_count = $4
              WHERE id = $1`,
            [row.id, result.status ?? 0, (result.body ?? '').slice(0, 1000), nextAttempt],
          );
          dead++;
          logger.warn({ delivery_id: row.id }, 'webhook:dead-letter');
        } else {
          const delay = RETRY_SCHEDULE_SEC[Math.min(nextAttempt, RETRY_SCHEDULE_SEC.length - 1)];
          await pool.query(
            `UPDATE agent_webhook_deliveries
                SET status = 'pending',
                    last_response_code = $2,
                    last_response_body = $3,
                    attempt_count = $4,
                    next_retry_at = NOW() + ($5 || ' seconds')::interval
              WHERE id = $1`,
            [row.id, result.status ?? 0, (result.body ?? '').slice(0, 1000), nextAttempt, String(delay)],
          );
          retried++;
        }
      }
    }

    return { checked: due.rowCount ?? 0, delivered, retried, dead };
  }
}

// ─── deliverer (single attempt) ────────────────────────────────────────────

async function attemptOnce(
  url: string,
  payload: any,
  headers: { idempotency_key: string; hmac_signature: string },
): Promise<{ ok: boolean; terminal?: boolean; status?: number; body?: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-openx-delivery-id': headers.idempotency_key,
        'x-openx-signature': headers.hmac_signature,
      },
      body,
      signal: ac.signal,
    });
    if (res.ok) return { ok: true, status: res.status };
    // 4xx → terminal failure (don't retry — receiver's contract is wrong)
    if (res.status >= 400 && res.status < 500) {
      const text = await res.text().catch(() => '');
      return { ok: false, terminal: true, status: res.status, body: text };
    }
    // 5xx → schedule retry
    const text = await res.text().catch(() => '');
    return { ok: false, status: res.status, body: text };
  } catch (err) {
    return {
      ok: false,
      body: (err as Error).message ?? 'network_error',
      status: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function verifyWebhookSignature(body: string, signature: string): boolean {
  const expected = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  return signature === expected;
}

// ─── in-process async task runner ──────────────────────────────────────────
//
// Boot this from server.ts. It polls pending tasks every TICK_MS, claims one
// atomically, runs it via the provided executor, and marks complete/failed.
// Webhook delivery is scheduled by completeTask/failTask and drained by the
// worker process (jobs/webhook-retry.ts).
//
// `executor` is injected so this service stays free of the runInference
// import (which would create a cycle: v1Public.ts → asyncTaskService →
// v1Public.ts.runInference). Server bootstraps with a closure over the
// inference function.
type TaskExecutor = (task: TaskRow) => Promise<{ answer: unknown; tee_attestation_hash?: string }>;

const RUNNER_TICK_MS = Math.max(1000, Number(process.env.OPENX_ASYNC_RUNNER_TICK_MS ?? 3_000));

export function startAsyncTaskRunner(executor: TaskExecutor): void {
  if (process.env.FEATURE_BUYER_AGENT_COMM !== 'true') {
    logger.info('async-task-runner disabled (FEATURE_BUYER_AGENT_COMM not true)');
    return;
  }
  logger.info({ tick_ms: RUNNER_TICK_MS }, 'async-task-runner:starting');

  const tick = async () => {
    try {
      const task = await asyncTaskService.claimNextPending();
      if (!task) return;
      try {
        const result = await executor(task);
        await asyncTaskService.completeTask(task.id, result.answer, result.tee_attestation_hash);
      } catch (err) {
        await asyncTaskService.failTask(task.id, (err as Error).message ?? 'unknown');
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'async-task-runner:tick-failed');
    }
  };
  setInterval(tick, RUNNER_TICK_MS);
}

export const asyncTaskService: IAsyncTaskService = new AsyncTaskService();
