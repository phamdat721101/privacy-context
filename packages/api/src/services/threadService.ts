/**
 * threadService — bounded context for buyer↔agent threads, messages, and
 * unified inbox aggregation.
 *
 * Modes (PRD-2 MVP):
 *   M1 — paid query (existing); attested on inference response.
 *   M2 — mid-call clarification (paid call returns 200 with clarification body;
 *        buyer follows up via /api/v1/<slug>/clarify with the original payment).
 *   M3 — async task; message rows are created when the task completes.
 *   M4 — buyer-initiated message in a thread (microbilled via /api/v1/<slug>
 *        with `tool: "message"` against the n-payment provider).
 *
 * SOLID:
 *   • SRP — threads + messages + inbox aggregation only.
 *   • OCP — `attestMessage()` is private but exported; can be swapped for
 *           a real Phala TEE attestation when ready.
 *   • DIP — exported via IThreadService.
 */

import { createHash } from 'node:crypto';
import { pool } from '../db';
import { logger } from '../lib';
import { notifyService } from './notifyService';

// ─── types ─────────────────────────────────────────────────────────────────

export type Mode = 'm1' | 'm2' | 'm3' | 'm4';
export type SenderType = 'buyer' | 'agent' | 'operator' | 'system';

export interface ThreadRow {
  id: string;
  buyer_wallet: string;
  agent_id: string;
  status: string;
  message_count: number;
  last_message_at: string;
  origin_paid_call_id: string | null;
  created_at: string;
}

export interface MessageRow {
  id: string;
  thread_id: string;
  sender_type: SenderType;
  sender_id: string;
  mode: Mode;
  body: string;
  tee_attestation_hash: string;
  payment_event_id: string | null;
  delivery_status: string;
  created_at: string;
}

export type InboxItem =
  | (MessageRow & { item_type: 'message'; agent_slug?: string | null })
  | {
      item_type: 'task_update';
      task_id: string;
      thread_id: string | null;
      agent_id: string;
      status: 'pending' | 'running' | 'complete' | 'failed';
      preview: string;
      created_at: string;
    }
  | {
      item_type: 'paid_call';
      paid_call_id: string;
      agent_id: string;
      slug: string;
      amount_usdc: string;
      method: string;
      created_at: string;
    };

export interface IThreadService {
  createThread(input: {
    buyer_wallet: string;
    agent_id: string;
    origin_paid_call_id?: string;
  }): Promise<ThreadRow>;
  addMessage(input: {
    thread_id: string;
    sender_type: SenderType;
    sender_id: string;
    mode: Mode;
    body: string;
    payment_event_id?: string;
  }): Promise<MessageRow>;
  getThread(thread_id: string, requester_wallet: string): Promise<ThreadRow | null>;
  listMessages(thread_id: string, cursor?: string, limit?: number): Promise<MessageRow[]>;
  aggregateInbox(buyer_wallet: string, cursor?: string, limit?: number): Promise<InboxItem[]>;
  listOwnedThreads(owner_wallet: string, limit?: number): Promise<ThreadRow[]>;
}

// ─── attestation helper (deterministic SHA-256 stand-in for TEE) ───────────
//
// Phala TEE attestation produces a hash signed by an enclave key. Until that
// path is wired through chat.ts, we emit a deterministic SHA-256 hash over
// the same inputs so downstream code (the message badge, smoke tests) can
// rely on a stable contract. Swap implementation when TEE attestation lands.
function attestMessage(input: {
  thread_id: string;
  sender_id: string;
  body: string;
  ts_floor_sec?: number;
}): string {
  const ts = input.ts_floor_sec ?? Math.floor(Date.now() / 1000);
  const canonical = `${input.thread_id}|${input.sender_id}|${input.body}|${ts}`;
  return '0x' + createHash('sha256').update(canonical).digest('hex');
}

// ─── implementation ────────────────────────────────────────────────────────

class ThreadService implements IThreadService {
  async createThread(input: {
    buyer_wallet: string;
    agent_id: string;
    origin_paid_call_id?: string;
  }): Promise<ThreadRow> {
    const r = await pool.query<ThreadRow>(
      `INSERT INTO agent_threads (buyer_wallet, agent_id, origin_paid_call_id)
       VALUES (LOWER($1), $2, $3)
       RETURNING id, buyer_wallet, agent_id, status, message_count,
                 last_message_at, origin_paid_call_id, created_at`,
      [input.buyer_wallet, input.agent_id, input.origin_paid_call_id ?? null],
    );
    logger.info(
      { thread_id: r.rows[0].id, agent_id: input.agent_id },
      'thread:created',
    );
    return r.rows[0];
  }

  async addMessage(input: {
    thread_id: string;
    sender_type: SenderType;
    sender_id: string;
    mode: Mode;
    body: string;
    payment_event_id?: string;
  }): Promise<MessageRow> {
    const attestation = attestMessage({
      thread_id: input.thread_id,
      sender_id: input.sender_id,
      body: input.body,
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const insert = await client.query<MessageRow>(
        `INSERT INTO agent_messages
           (thread_id, sender_type, sender_id, mode, body,
            tee_attestation_hash, payment_event_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, thread_id, sender_type, sender_id, mode, body,
                   tee_attestation_hash, payment_event_id, delivery_status,
                   created_at`,
        [
          input.thread_id,
          input.sender_type,
          input.sender_id,
          input.mode,
          input.body,
          attestation,
          input.payment_event_id ?? null,
        ],
      );
      await client.query(
        `UPDATE agent_threads
            SET message_count = message_count + 1,
                last_message_at = NOW()
          WHERE id = $1`,
        [input.thread_id],
      );

      // Notify any open SSE subscribers for the buyer's inbox.
      const owner = await client.query<{ buyer_wallet: string }>(
        `SELECT buyer_wallet FROM agent_threads WHERE id = $1`,
        [input.thread_id],
      );
      const buyer = owner.rows[0]?.buyer_wallet;
      await client.query('COMMIT');

      if (buyer) {
        // pg_notify is fire-and-forget; sender doesn't block on consumer.
        await pool
          .query(`SELECT pg_notify($1, $2)`, [
            inboxChannel(buyer),
            JSON.stringify({
              type: 'message',
              thread_id: input.thread_id,
              message_id: insert.rows[0].id,
              mode: input.mode,
              preview: input.body.slice(0, 120),
              created_at: insert.rows[0].created_at,
            }),
          ])
          .catch((err) => logger.warn({ err: err.message }, 'thread:notify-failed'));
      }

      // Seller-side webhook for buyer-originated messages. Fire-and-forget;
      // no-op when the agent has no notification_webhook_url. The notify
      // service handles failures internally — never throws back.
      if (input.sender_type === 'buyer') {
        const agentRow = await pool.query<{ agent_id: string }>(
          `SELECT agent_id FROM agent_threads WHERE id = $1`,
          [input.thread_id],
        );
        const agent_id = agentRow.rows[0]?.agent_id;
        if (agent_id) {
          await notifyService.notify(
            agent_id,
            'message.created',
            {
              thread_id: input.thread_id,
              message_id: insert.rows[0].id,
              sender_wallet: input.sender_id,
              mode: input.mode,
              body: input.body,
            },
            `message:${insert.rows[0].id}`,
          );
        }
      }
      return insert.rows[0];
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async getThread(thread_id: string, requester_wallet: string): Promise<ThreadRow | null> {
    if (!/^\d+$/.test(String(thread_id))) return null;
    const r = await pool.query<ThreadRow>(
      `SELECT t.id, t.buyer_wallet, t.agent_id, t.status, t.message_count,
              t.last_message_at, t.origin_paid_call_id, t.created_at
         FROM agent_threads t
         LEFT JOIN agents a ON a.id = t.agent_id
        WHERE t.id = $1
          AND (LOWER(t.buyer_wallet) = LOWER($2) OR LOWER(a.owner_address) = LOWER($2))
        LIMIT 1`,
      [thread_id, requester_wallet],
    );
    return r.rows[0] ?? null;
  }

  async listMessages(thread_id: string, cursor?: string, limit = 50): Promise<MessageRow[]> {
    if (!/^\d+$/.test(String(thread_id))) return [];
    const cap = Math.min(Math.max(limit, 1), 100);
    const params: any[] = [thread_id, cap];
    let cursorClause = '';
    if (cursor) {
      params.push(cursor);
      cursorClause = `AND created_at < $${params.length}::timestamptz`;
    }
    const r = await pool.query<MessageRow>(
      `SELECT id, thread_id, sender_type, sender_id, mode, body,
              tee_attestation_hash, payment_event_id, delivery_status, created_at
         FROM agent_messages
        WHERE thread_id = $1 ${cursorClause}
     ORDER BY created_at ASC
        LIMIT $2`,
      params,
    );
    return r.rows;
  }

  async aggregateInbox(buyer_wallet: string, cursor?: string, limit = 20): Promise<InboxItem[]> {
    const cap = Math.min(Math.max(limit, 1), 100);
    const cursorTs = cursor ? new Date(cursor) : new Date('2099-01-01');
    const wallet = buyer_wallet.toLowerCase();

    // Fan-out in parallel — three independent queries against indexed columns.
    const [msgs, tasks, calls] = await Promise.all([
      pool.query<{
        id: string;
        thread_id: string;
        sender_type: SenderType;
        sender_id: string;
        mode: Mode;
        body: string;
        tee_attestation_hash: string;
        payment_event_id: string | null;
        delivery_status: string;
        created_at: string;
        agent_slug: string | null;
      }>(
        `SELECT m.id, m.thread_id, m.sender_type, m.sender_id, m.mode, m.body,
                m.tee_attestation_hash, m.payment_event_id, m.delivery_status, m.created_at,
                a.slug AS agent_slug
           FROM agent_messages m
           JOIN agent_threads t ON t.id = m.thread_id
      LEFT JOIN agents a ON a.id = t.agent_id
          WHERE LOWER(t.buyer_wallet) = $1
            AND m.created_at < $2
       ORDER BY m.created_at DESC
          LIMIT $3`,
        [wallet, cursorTs, cap],
      ),
      pool.query<{
        id: string;
        thread_id: string | null;
        agent_id: string;
        status: 'pending' | 'running' | 'complete' | 'failed';
        result: { answer?: string } | null;
        payload: { question?: string } | null;
        created_at: string;
      }>(
        `SELECT id, thread_id, agent_id, status, result, payload, created_at
           FROM agent_tasks
          WHERE LOWER(buyer_wallet) = $1
            AND created_at < $2
       ORDER BY created_at DESC
          LIMIT $3`,
        [wallet, cursorTs, cap],
      ),
      pool.query<{
        id: string;
        agent_id: string;
        slug: string;
        amount_usdc: string;
        method: string;
        created_at: string;
      }>(
        `SELECT id, agent_id, slug, amount_usdc, method, created_at
           FROM paid_calls
          WHERE LOWER(buyer) = $1
            AND created_at < $2
       ORDER BY created_at DESC
          LIMIT $3`,
        [wallet, cursorTs, cap],
      ),
    ]);

    const items: InboxItem[] = [
      ...msgs.rows.map<InboxItem>((m) => ({
        ...m,
        item_type: 'message' as const,
      })),
      ...tasks.rows.map<InboxItem>((t) => ({
        item_type: 'task_update' as const,
        task_id: t.id,
        thread_id: t.thread_id,
        agent_id: t.agent_id,
        status: t.status,
        preview:
          t.status === 'complete'
            ? (t.result?.answer ?? '').slice(0, 120)
            : `Task ${t.status}${t.payload?.question ? `: ${t.payload.question.slice(0, 100)}` : ''}`,
        created_at: t.created_at,
      })),
      ...calls.rows.map<InboxItem>((c) => ({
        item_type: 'paid_call' as const,
        paid_call_id: c.id,
        agent_id: c.agent_id,
        slug: c.slug,
        amount_usdc: c.amount_usdc,
        method: c.method,
        created_at: c.created_at,
      })),
    ];

    items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return items.slice(0, cap);
  }

  async listOwnedThreads(owner_wallet: string, limit = 50): Promise<ThreadRow[]> {
    const r = await pool.query<ThreadRow>(
      `SELECT t.id, t.buyer_wallet, t.agent_id, t.status, t.message_count,
              t.last_message_at, t.origin_paid_call_id, t.created_at
         FROM agent_threads t
         JOIN agents a ON a.id = t.agent_id
        WHERE LOWER(a.owner_address) = LOWER($1)
     ORDER BY t.last_message_at DESC
        LIMIT $2`,
      [owner_wallet, Math.min(Math.max(limit, 1), 100)],
    );
    return r.rows;
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────

export function inboxChannel(wallet: string): string {
  // pg channel names must be valid identifiers — strip 0x + use first 32 chars.
  const safe = wallet.toLowerCase().replace(/^0x/, '').slice(0, 32);
  return `inbox_${safe}`;
}

export { attestMessage };

export const threadService: IThreadService = new ThreadService();
