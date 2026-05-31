import { Router, Request, Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { registerLink, getLinkByEth, getLinkBySui } from '../services/agentLinkOracle';
import { paymentGate, PriceableRequest } from '../middleware/paymentGate';
import { issueBundle, getBundle, verifyManifest } from '../services/bundleService';
import { discover } from '../services/discoveryService';
import { streamBundle } from '../services/hostedRunner';
import { pool } from '../db';
import { logger } from '../lib';
import type { AuthRequest } from '../middleware/auth';

/**
 * v3 — Dual-chain agentic marketplace API.
 *
 * Mounted at /v3 in server.ts. Sub-resources:
 *   /v3/links       — AgentLink (T4–T5)
 *   /v3/agents      — Agent CRUD + invocation gateway (T6, T10)
 *   /v3/bundles     — BundlePrompt issue + verify (T14)
 *   /v3/discover    — discovery concierge (T13)
 *   /v3/runner      — hosted manifest runner (T16)
 *   /v3/earnings    — per-rail breakdown (T12)
 *
 * Auth: routes are mounted *after* the existing `auth` middleware in
 * server.ts; handlers may further gate on ownership.
 */
const v3 = Router();

// ---------------------------------------------------------------------------
// /v3/version — health/diagnostic ping. Frontend uses this to confirm the API
// has the v3 router built in. Public (no auth needed at the route level —
// the parent /v3 mount adds auth, so server.ts mounts /v3 with auth-skip for
// this path; see fix in server.ts).
// ---------------------------------------------------------------------------
v3.get('/version', (_req: Request, res: Response) => {
  res.json({
    api: 'openx-v3',
    build: process.env.GIT_SHA ?? 'dev',
    started_at: process.env.PROC_START ?? null,
    routes: ['/links', '/agents', '/bundles', '/discover', '/runner', '/earnings'],
  });
});

// ---------------------------------------------------------------------------
// /v3/agents/slug-available — preflight check used by the publish wizard.
// Public (no auth) — slug presence is public information.
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9-]{3,30}$/;
const RESERVED_SLUGS = new Set(['api', 'admin', 'health', 'metrics', 'well-known', 'platform']);

v3.get('/agents/slug-available', async (req: Request, res: Response) => {
  const slug = String(req.query.slug ?? '').trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return res.json({ available: false, reason: 'invalid' });
  if (RESERVED_SLUGS.has(slug)) return res.json({ available: false, reason: 'reserved' });
  const r = await pool.query(`SELECT 1 FROM agents WHERE slug = $1`, [slug]);
  if ((r.rowCount ?? 0) > 0) return res.json({ available: false, reason: 'taken' });
  res.json({ available: true });
});

// ---------------------------------------------------------------------------
// /v3/links — AgentLink registration + lookup
// ---------------------------------------------------------------------------

v3.post('/links', async (req: Request, res: Response) => {
  try {
    const link = await registerLink(req.body ?? {});
    res.json(link);
  } catch (err) {
    const msg = (err as Error).message;
    logger.warn({ msg }, 'v3:links:register:failed');
    res.status(400).json({ error: msg });
  }
});

v3.get('/links/by-eth/:address', async (req: Request, res: Response) => {
  const link = await getLinkByEth(req.params.address);
  if (!link) return res.status(404).json({ error: 'not-found' });
  res.json(link);
});

v3.get('/links/by-sui/:address', async (req: Request, res: Response) => {
  const link = await getLinkBySui(req.params.address);
  if (!link) return res.status(404).json({ error: 'not-found' });
  res.json(link);
});

// ---------------------------------------------------------------------------
// /v3/agents — Agent CRUD + invocation gateway (T6 + T10)
// ---------------------------------------------------------------------------

v3.post('/agents', async (req: AuthRequest, res: Response) => {
  const ctx = { wallet: req.user?.address, body: req.body };
  try {
    const { brain_id, persona, pricing, kya_required, min_reputation, chain, slug } = req.body ?? {};
    if (!brain_id || !persona || !pricing || !chain) {
      logger.warn(ctx, 'v3:agents:create:bad-request');
      return res.status(400).json({ error: 'brain_id, persona, pricing, chain required' });
    }
    if (!req.user?.address) {
      logger.warn(ctx, 'v3:agents:create:unauthenticated');
      return res.status(401).json({ error: 'auth required' });
    }
    if (slug !== undefined && !SLUG_RE.test(String(slug))) {
      return res.status(400).json({ error: 'invalid slug' });
    }
    if (slug && RESERVED_SLUGS.has(String(slug).toLowerCase())) {
      return res.status(400).json({ error: 'reserved slug' });
    }
    const r = await pool.query(
      `INSERT INTO agents (brain_id, owner_address, chain, persona, pricing, kya_required, min_reputation, published, slug)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, false, $8)
       RETURNING id, brain_id, owner_address, chain, persona, pricing, kya_required, min_reputation, published, slug, created_at`,
      [brain_id, req.user.address, chain, JSON.stringify(persona), JSON.stringify(pricing), !!kya_required, min_reputation ?? 0, slug ?? null],
    );
    logger.info({ ...ctx, agentId: r.rows[0].id, slug }, 'v3:agents:create:ok');
    res.json(r.rows[0]);
  } catch (err) {
    const e = err as Error & { code?: string };
    const isMissingTable = e.code === '42P01';
    const isDuplicateSlug = e.code === '23505' && e.message.includes('agents_slug_key');
    logger.error({ ...ctx, err: e.message, code: e.code, stack: e.stack }, 'v3:agents:create:failed');
    res.status(isDuplicateSlug ? 409 : 500).json({
      error: isMissingTable
        ? 'agents table missing — run migration 004_v3_agentic.sql'
        : isDuplicateSlug
        ? 'slug already taken'
        : e.message,
      code: e.code ?? null,
    });
  }
});

v3.post('/agents/:id/publish', async (req: AuthRequest, res: Response) => {
  const ctx = { wallet: req.user?.address, agentId: req.params.id };
  try {
    const r = await pool.query(
      `UPDATE agents SET published = true WHERE id = $1 AND owner_address = $2
       RETURNING id, published`,
      [req.params.id, req.user?.address ?? ''],
    );
    if (r.rowCount === 0) {
      logger.warn(ctx, 'v3:agents:publish:not-owner');
      return res.status(403).json({ error: 'not owner or not found' });
    }
    logger.info(ctx, 'v3:agents:publish:ok');
    res.json(r.rows[0]);
  } catch (err) {
    const e = err as Error & { code?: string };
    logger.error({ ...ctx, err: e.message, code: e.code }, 'v3:agents:publish:failed');
    res.status(500).json({ error: e.message, code: e.code ?? null });
  }
});

/**
 * PATCH /v3/agents/:id — owner partial update of `persona` and/or `pricing`.
 * Used by the studio Settings tab to edit the agent prompt without re-publishing.
 * Invalidates the v1Public provider cache so the next `/api/v1/<slug>` call
 * picks up the new prompt within ~1s of save.
 */
v3.patch('/agents/:id', async (req: AuthRequest, res: Response) => {
  const ctx = { wallet: req.user?.address, agentId: req.params.id };
  if (!req.user?.address) return res.status(401).json({ error: 'auth required' });
  const { persona, pricing } = req.body ?? {};
  if (!persona && !pricing) return res.status(400).json({ error: 'persona or pricing required' });
  if (persona?.system_prompt && typeof persona.system_prompt === 'string' && persona.system_prompt.length > 4000) {
    return res.status(400).json({ error: 'system_prompt too long (max 4000 chars)' });
  }
  try {
    const r = await pool.query(
      `UPDATE agents
          SET persona = COALESCE($3::jsonb, persona),
              pricing = COALESCE($4::jsonb, pricing)
        WHERE id = $1 AND owner_address = $2
        RETURNING id, slug, persona, pricing`,
      [
        req.params.id,
        req.user.address,
        persona ? JSON.stringify(persona) : null,
        pricing ? JSON.stringify(pricing) : null,
      ],
    );
    if (r.rowCount === 0) {
      logger.warn(ctx, 'v3:agents:patch:not-owner');
      return res.status(403).json({ error: 'not owner or not found' });
    }
    // Evict v1Public provider cache so the new prompt/price ships on next call.
    if (r.rows[0].slug) {
      const { invalidateProvider } = await import('./v1Public');
      invalidateProvider(r.rows[0].slug);
    }
    logger.info(ctx, 'v3:agents:patch:ok');
    res.json(r.rows[0]);
  } catch (err) {
    const e = err as Error & { code?: string };
    logger.error({ ...ctx, err: e.message, code: e.code }, 'v3:agents:patch:failed');
    res.status(500).json({ error: e.message, code: e.code ?? null });
  }
});

v3.get('/agents', async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 100);
  const r = await pool.query(
    `SELECT id, brain_id, owner_address, chain, persona, pricing, kya_required, min_reputation, published, slug, created_at
     FROM agents WHERE published = true ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  res.json(r.rows);
});

v3.get('/agents/:id', async (req: Request, res: Response) => {
  const r = await pool.query(
    `SELECT id, brain_id, owner_address, chain, persona, pricing, kya_required, min_reputation, published, slug, created_at
     FROM agents WHERE id = $1`,
    [req.params.id],
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'not found' });
  res.json(r.rows[0]);
});

v3.get('/agents/by-owner/:owner', async (req: Request, res: Response) => {
  const r = await pool.query(
    `SELECT id, brain_id, owner_address, chain, persona, pricing, kya_required, min_reputation, published, slug, created_at
     FROM agents WHERE owner_address = $1 ORDER BY created_at DESC`,
    [req.params.owner.toLowerCase()],
  );
  res.json(r.rows);
});

// ─── PRD-2: free, rate-limited try-it endpoint ─────────────────────────────
//
// Lets buyers test a published agent without a wallet/USDC. The same
// `runInference` path the paid surface uses; we just bypass the paywall
// and log to `paid_calls` with `method='demo'` so seller earnings can
// filter cleanly. Rate-limited per (IP, agent) and per agent, in-memory,
// no Redis. Bounded memory: O(active keys × calls/day).

const tryLimiter = new Map<string, number[]>();
const TRY_DAY_MS = 24 * 60 * 60 * 1000;
function tryAllow(key: string, capPerDay: number): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const cutoff = now - TRY_DAY_MS;
  const hits = (tryLimiter.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= capPerDay) {
    const retryAfterSec = Math.ceil((hits[0] + TRY_DAY_MS - now) / 1000);
    tryLimiter.set(key, hits);
    return { ok: false, retryAfterSec };
  }
  hits.push(now);
  tryLimiter.set(key, hits);
  return { ok: true };
}

v3.post('/agents/:id/try', async (req: Request, res: Response) => {
  const id = req.params.id;
  const q = String(req.body?.q ?? '').trim();
  if (!q || q.length > 2000) return res.status(400).json({ error: 'q required, ≤2000 chars' });

  // Privacy: hash the IP rather than store it. 12 hex chars = 48 bits, plenty
  // for keying without re-identification.
  const ipHash = createHash('sha256').update(req.ip ?? 'unknown').digest('hex').slice(0, 12);
  const perIp = tryAllow(`ip:${ipHash}:agent:${id}`, 10);
  if (!perIp.ok) {
    res.set('Retry-After', String(perIp.retryAfterSec));
    return res.status(429).json({ error: 'try limit reached for this agent today', retryAfterSec: perIp.retryAfterSec });
  }
  const perAgent = tryAllow(`agent:${id}`, 100);
  if (!perAgent.ok) {
    res.set('Retry-After', String(perAgent.retryAfterSec));
    return res.status(429).json({ error: 'agent demo cap reached today', retryAfterSec: perAgent.retryAfterSec });
  }

  const r = await pool.query(
    `SELECT id, slug, brain_id, owner_address, persona, pricing FROM agents WHERE id = $1 AND published = true`,
    [id],
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'agent not found' });
  const agent = r.rows[0];

  try {
    const { runInference } = await import('./v1Public');
    const { record } = await import('../services/paidCallLedger');
    const result = await runInference(
      { brain_id: agent.brain_id, persona: agent.persona },
      q,
    );
    const txHash = `demo-${randomUUID()}`;
    await record({
      agentId: agent.id,
      slug: agent.slug ?? `agent-${agent.id}`,
      buyer: 'demo',
      amountUsdc: '0',
      txHash,
      network: process.env.X402_NETWORK ?? 'arbitrum-sepolia',
      method: 'demo',
    });
    logger.info({ agentId: agent.id, ipHash }, 'service:try:end');
    res.json({ ...result, settled: { method: 'demo', txHash, demo: true } });
  } catch (err) {
    logger.error({ agentId: agent.id, err: (err as Error).message }, 'service:try:failed');
    res.status(500).json({ error: 'inference failed' });
  }
});

/**
 * POST /v3/agents/:id/chat — paid invocation. Returns 402 with all enabled
 * rails as `WWW-Authenticate: Payment` headers; on receipt, runs inference
 * over the underlying brain and returns the answer.
 */
v3.post('/agents/:id/chat', paymentGate as any, async (req: PriceableRequest, res: Response) => {
  const agent = req.pricedAgent!;
  const message: string = req.body?.message ?? '';
  if (!message) return res.status(400).json({ error: 'message required' });

  // Delegate to the existing inference path. For Standard tier (Fhenix),
  // we reuse the v2 chat service against the agent's brain. Sui-tier agents
  // currently fall back to the same path until the SealBrainClient is wired
  // server-side (mock-first).
  try {
    const { ChatService } = await import('../services/chat');
    const { buildSystemPrompt } = await import('./v1Public');
    const buyer = req.user?.address ?? 'agent-anonymous';
    // Use the canonical prompt-merger so v3 chat and v1 paid-API path emit
    // byte-identical system prompts for the same (persona, message) input.
    // Fixes a latent bug where this site rendered "undefined\n\nUser:…" when
    // the seller never set persona.system_prompt (the wizard's prior payload).
    const sellerPrompt = buildSystemPrompt(agent.persona, '');
    const result = await ChatService.chat(
      buyer,
      `${sellerPrompt}\n\nUser: ${message}`,
      String(agent.brain_id),
      'learn',
      agent.chain,
    );
    res.json({
      response: result.response,
      sources: result.sources ?? [],
      agent_id: agent.id,
      receipt: req.receipt,
      attestation: { provider: 'phala-tee', verified: true, mock: true },
    });

    // Cognitive Memory v1 — non-blocking L1 episode write + consolidation pass.
    // Errors are logged at WARN, never crash the chat response. The chat
    // reply has already been sent above; this runs in the same tick but
    // detached from the response lifecycle.
    Promise.resolve().then(async () => {
      try {
        const { writeEpisode, consolidateAndWrite } = await import('../services/cognitiveMemoryService');
        const ownerAddr = String(agent.owner_address);
        await writeEpisode({
          ownerAddr,
          agentId: buyer,
          brainId: Number(agent.brain_id),
          // Topic = 16-hex of keccak-like; reuse the existing message-derived
          // sha-256 short hash to stay deterministic and dependency-light.
          topic: shortTopicHash(message),
          sessionId: `session-${agent.id}-${buyer}`,
          body: `${message} → ${result.response}`,
        });
        const consolidation = await consolidateAndWrite(ownerAddr);
        if (consolidation.newFacts > 0 || consolidation.newBundles > 0) {
          logger.info({ owner: ownerAddr, ...consolidation }, 'v3:agent:chat:cognitive:promoted');
        }
      } catch (err) {
        logger.warn({ err: (err as Error).message, agentId: agent.id }, 'v3:agent:chat:cognitive:failed');
      }
    });
  } catch (err) {
    logger.error({ err: (err as Error).message, agentId: agent.id }, 'v3:agent:chat:failed');
    res.status(500).json({ error: 'inference failed' });
  }
});

// 16-hex deterministic short hash for the topic attribute. Kept inline (one
// helper, used only here) per "essential files only".
function shortTopicHash(s: string): string {
  return createHash('sha256').update(s.toLowerCase().slice(0, 200), 'utf8').digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// /v3/earnings/:wallet — per-rail breakdown (T12)
// ---------------------------------------------------------------------------

v3.get('/earnings/:wallet', async (req: Request, res: Response) => {
  const wallet = req.params.wallet.toLowerCase();
  const r = await pool.query(
    `SELECT ar.rail, COUNT(*) AS calls, COALESCE(SUM(ar.amount_usdc), 0) AS total_usdc
     FROM agent_receipts ar JOIN agents a ON a.id = ar.agent_id
     WHERE a.owner_address = $1
     GROUP BY ar.rail`,
    [wallet],
  );
  const recent = await pool.query(
    `SELECT ar.rail, ar.amount_usdc, ar.tx_or_receipt, ar.created_at, a.id AS agent_id
     FROM agent_receipts ar JOIN agents a ON a.id = ar.agent_id
     WHERE a.owner_address = $1
     ORDER BY ar.created_at DESC LIMIT 20`,
    [wallet],
  );
  res.json({ totals_by_rail: r.rows, recent_receipts: recent.rows });
});

// ---------------------------------------------------------------------------
// /v3/bundles — BundlePrompt issue + verify (T14)
// ---------------------------------------------------------------------------

v3.post('/bundles', async (req: Request, res: Response) => {
  try {
    const manifest = await issueBundle(req.body ?? {});
    res.json(manifest);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

v3.get('/bundles/:id', async (req: Request, res: Response) => {
  const m = await getBundle(req.params.id);
  if (!m) return res.status(404).json({ error: 'not found' });
  res.json(m);
});

v3.post('/bundles/:id/verify', async (req: Request, res: Response) => {
  const m = await getBundle(req.params.id);
  if (!m) return res.status(404).json({ error: 'not found' });
  const result = verifyManifest(m);
  res.json(result);
});

// ---------------------------------------------------------------------------
// /v3/discover — concierge endpoint (T13). Returns candidates + signed bundle.
// ---------------------------------------------------------------------------

v3.post('/discover', async (req: Request, res: Response) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const result = await discover(req.body ?? { message: '' }, baseUrl);
  res.json(result);
});

// ---------------------------------------------------------------------------
// /v3/runner/:id — hosted runner SSE (T16). Optional path; manifest mode is canonical.
// ---------------------------------------------------------------------------

v3.post('/runner/:id', streamBundle as any);

export default v3;
