/**
 * /v3/threads + /v3/inbox + /v3/inbox/stream — PRD-2 communication surface.
 *
 * Mounted in routes/v3.ts. All routes inherit /v3 auth + agentKya from
 * server.ts (no whitelist additions — buyer identity is required to see
 * messages addressed to them).
 *
 * SOLID:
 *   • SRP — HTTP shell only. Logic lives in threadService + asyncTaskService.
 *   • DIP — depends on the IThreadService interface, never the impl directly.
 */

import { Router, Response } from 'express';
import { pool } from '../db';
import { logger } from '../lib';
import type { AuthRequest } from '../middleware/auth';
import { threadService, inboxChannel } from '../services/threadService';
import { asyncTaskService } from '../services/asyncTaskService';

const router = Router();

function flagOn(): boolean {
  return process.env.FEATURE_BUYER_AGENT_COMM === 'true';
}

function notFoundIfOff(res: Response): boolean {
  if (!flagOn()) {
    res.status(404).json({ error: 'not_found' });
    return true;
  }
  return false;
}

// ─── POST /v3/threads — create empty thread ────────────────────────────────

router.post('/threads', async (req: AuthRequest, res: Response) => {
  if (notFoundIfOff(res)) return;
  const wallet = req.user?.address;
  if (!wallet) return res.status(401).json({ error: 'auth_required' });
  const { agent_id, origin_paid_call_id } = req.body ?? {};
  if (!agent_id) return res.status(400).json({ error: 'agent_id_required' });
  try {
    const t = await threadService.createThread({
      buyer_wallet: wallet,
      agent_id: String(agent_id),
      origin_paid_call_id: origin_paid_call_id ? String(origin_paid_call_id) : undefined,
    });
    res.json(t);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'thread:create:failed');
    res.status(500).json({ error: 'thread_create_failed' });
  }
});

// ─── GET /v3/threads — list buyer's threads OR ?owner=true for operator side
router.get('/threads', async (req: AuthRequest, res: Response) => {
  if (notFoundIfOff(res)) return;
  const wallet = req.user?.address;
  if (!wallet) return res.status(401).json({ error: 'auth_required' });
  try {
    if (req.query.owner === 'true') {
      const owned = await threadService.listOwnedThreads(wallet);
      return res.json({ threads: owned });
    }
    const r = await pool.query(
      `SELECT t.id, t.buyer_wallet, t.agent_id, t.status, t.message_count,
              t.last_message_at, t.origin_paid_call_id, t.created_at,
              a.slug AS agent_slug, a.persona AS agent_persona
         FROM agent_threads t
    LEFT JOIN agents a ON a.id = t.agent_id
        WHERE LOWER(t.buyer_wallet) = LOWER($1)
     ORDER BY t.last_message_at DESC
        LIMIT 50`,
      [wallet],
    );
    res.json({ threads: r.rows });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'thread:list:failed');
    res.status(500).json({ error: 'thread_list_failed' });
  }
});

// ─── GET /v3/threads/:id/messages — paginated message list ─────────────────

router.get('/threads/:id/messages', async (req: AuthRequest, res: Response) => {
  if (notFoundIfOff(res)) return;
  const wallet = req.user?.address;
  if (!wallet) return res.status(401).json({ error: 'auth_required' });
  const thread = await threadService.getThread(req.params.id, wallet);
  if (!thread) return res.status(404).json({ error: 'thread_not_found' });
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const limit = req.query.limit ? Math.min(Number(req.query.limit), 100) : 50;
  const messages = await threadService.listMessages(req.params.id, cursor, limit);
  res.json({ thread, messages });
});

// ─── POST /v3/threads/:id/messages — buyer/operator sends a message ────────
//
// MVP: auth-gated; participants only (buyer or agent owner). Microbilling
// of buyer messages is enforced on the x402 path /api/v1/<slug> with
// tool="message" (PRD-2 T22). This route is the dev/manual surface.

router.post('/threads/:id/messages', async (req: AuthRequest, res: Response) => {
  if (notFoundIfOff(res)) return;
  const wallet = req.user?.address;
  if (!wallet) return res.status(401).json({ error: 'auth_required' });
  const thread = await threadService.getThread(req.params.id, wallet);
  if (!thread) return res.status(404).json({ error: 'thread_not_found' });
  const { body, mode } = (req.body ?? {}) as { body?: string; mode?: string };
  if (typeof body !== 'string' || !body.trim()) {
    return res.status(400).json({ error: 'body_required' });
  }
  const isOwner = thread.buyer_wallet.toLowerCase() !== wallet.toLowerCase();
  const sender_type: 'buyer' | 'operator' = isOwner ? 'operator' : 'buyer';
  const m = await threadService.addMessage({
    thread_id: req.params.id,
    sender_type,
    sender_id: wallet,
    mode: (mode === 'm2' || mode === 'm3' || mode === 'm4' || mode === 'm1') ? mode : 'm4',
    body: body.slice(0, 4000),
  });
  res.json({ message: m });
});

// ─── GET /v3/inbox — unified chronological feed across modes ───────────────

router.get('/inbox', async (req: AuthRequest, res: Response) => {
  if (notFoundIfOff(res)) return;
  const wallet = req.user?.address;
  if (!wallet) return res.status(401).json({ error: 'auth_required' });
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const limit = req.query.limit ? Math.min(Number(req.query.limit), 100) : 20;
  try {
    const items = await threadService.aggregateInbox(wallet, cursor, limit);
    const next_cursor = items.length > 0 ? items[items.length - 1].created_at : null;
    res.json({ items, next_cursor });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'inbox:aggregate:failed');
    res.status(500).json({ error: 'inbox_failed' });
  }
});

// ─── GET /v3/inbox/stream — SSE via Postgres LISTEN/NOTIFY ─────────────────
//
// The pg client opens one long-lived LISTEN connection per SSE client.
// On disconnect we UNLISTEN + release the client. Keep-alive ping every 25s
// guards against intermediate proxies dropping idle connections.

router.get('/inbox/stream', async (req: AuthRequest, res: Response) => {
  if (notFoundIfOff(res)) return;
  const wallet = req.user?.address;
  if (!wallet) return res.status(401).json({ error: 'auth_required' });

  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('connection', 'keep-alive');
  res.flushHeaders?.();

  const channel = inboxChannel(wallet);
  const client = await pool.connect();
  let closed = false;

  const onNotification = (msg: any) => {
    if (closed) return;
    if (msg.channel !== channel) return;
    res.write(`data: ${msg.payload ?? '{}'}\n\n`);
  };

  client.on('notification', onNotification);
  await client.query(`LISTEN "${channel}"`);
  res.write(`: connected\n\n`);

  const keepAlive = setInterval(() => {
    if (!closed) res.write(`: ping\n\n`);
  }, 25_000);

  const cleanup = async () => {
    if (closed) return;
    closed = true;
    clearInterval(keepAlive);
    try {
      await client.query(`UNLISTEN "${channel}"`);
    } catch {/* ignore */}
    client.removeListener('notification', onNotification);
    client.release();
  };

  req.on('close', cleanup);
  req.on('end', cleanup);
});

// ─── GET /v3/tasks/:id — internal status helper (also exposed under /api/v1/<slug>/tasks/:id)
router.get('/tasks/:id', async (req: AuthRequest, res: Response) => {
  if (notFoundIfOff(res)) return;
  const wallet = req.user?.address;
  if (!wallet) return res.status(401).json({ error: 'auth_required' });
  const t = await asyncTaskService.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'task_not_found' });
  if (t.buyer_wallet.toLowerCase() !== wallet.toLowerCase()) {
    return res.status(403).json({ error: 'not_owner' });
  }
  res.json(t);
});

export default router;
