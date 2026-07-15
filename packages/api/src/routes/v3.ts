import { Router, Request, Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { paymentGate, PriceableRequest } from '../middleware/paymentGate';
import { issueBundle, getBundle, verifyManifest } from '../services/bundleService';
import { discover, searchAgents } from '../services/discoveryService';
import { streamBundle } from '../services/hostedRunner';
import { pool } from '../db';
import { logger } from '../lib';
import { AgentTrainingService } from '../services/agentTrainingService';
import type { AuthRequest } from '../middleware/auth';

/**
 * v3 — Agentic marketplace API. Single-chain (Arbitrum + Fhenix) post-Sui-removal.
 *
 * Mounted at /v3 in server.ts. Sub-resources:
 *   /v3/agents      — Agent CRUD + invocation gateway
 *   /v3/bundles     — BundlePrompt issue + verify
 *   /v3/discover    — discovery concierge
 *   /v3/runner      — hosted manifest runner
 *   /v3/earnings    — per-rail breakdown
 *
 * Auth: routes are mounted *after* the existing `auth` middleware in
 * server.ts; handlers may further gate on ownership.
 */
const v3 = Router();

// Canonical UUID guard. `:id` path params flow straight into `WHERE id = $1`
// (uuid column); a non-UUID value makes Postgres throw *outside* a route's
// try/catch, which surfaces as an unhandled rejection and crashes the whole
// process. Validating at the boundary turns that into a clean 400. Mirrors
// the same idiom already used in v3-marketplace.ts (single source of truth).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const { persona, pricing, endpoint_url, notification_webhook_url } = req.body ?? {};
  if (
    persona === undefined &&
    pricing === undefined &&
    endpoint_url === undefined &&
    notification_webhook_url === undefined
  ) {
    return res.status(400).json({ error: 'persona, pricing, endpoint_url, or notification_webhook_url required' });
  }
  if (persona?.system_prompt && typeof persona.system_prompt === 'string' && persona.system_prompt.length > 4000) {
    return res.status(400).json({ error: 'system_prompt too long (max 4000 chars)' });
  }
  // URL safety — both fields must be HTTPS (or HTTP in dev) and not private/loopback.
  const urlCheck = (u: unknown): string | null | undefined => {
    if (u === undefined) return undefined;
    if (u === null || u === '') return null;
    if (typeof u !== 'string') return undefined;
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
      const host = parsed.hostname.toLowerCase();
      if (process.env.ALLOW_PRIVATE_ENDPOINTS !== '1') {
        if (['localhost', '0.0.0.0', '::1'].includes(host)) return undefined;
        if (host.endsWith('.internal') || host.endsWith('.local')) return undefined;
        if (/^127\.|^10\.|^192\.168\.|^169\.254\./.test(host)) return undefined;
        if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return undefined;
      }
      return u;
    } catch {
      return undefined;
    }
  };
  const endpointSafe = urlCheck(endpoint_url);
  const notifySafe = urlCheck(notification_webhook_url);
  if (endpoint_url !== undefined && endpointSafe === undefined) {
    return res.status(400).json({ error: 'invalid endpoint_url' });
  }
  if (notification_webhook_url !== undefined && notifySafe === undefined) {
    return res.status(400).json({ error: 'invalid notification_webhook_url' });
  }
  try {
    const r = await pool.query(
      `UPDATE agents
          SET persona = COALESCE($3::jsonb, persona),
              pricing = COALESCE($4::jsonb, pricing),
              endpoint_url = CASE WHEN $5::int = 1 THEN $6 ELSE endpoint_url END,
              notification_webhook_url = CASE WHEN $7::int = 1 THEN $8 ELSE notification_webhook_url END
        WHERE id = $1 AND owner_address = $2
        RETURNING id, slug, persona, pricing, endpoint_url, notification_webhook_url`,
      [
        req.params.id,
        req.user.address,
        persona ? JSON.stringify(persona) : null,
        pricing ? JSON.stringify(pricing) : null,
        endpoint_url !== undefined ? 1 : 0,
        endpointSafe ?? null,
        notification_webhook_url !== undefined ? 1 : 0,
        notifySafe ?? null,
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
    // Advisory — so sellers can SEE which engine answers their buyers.
    // Avoids the confused-Nim path where the webhook is wired but inference
    // still runs on OpenX's Bedrock because endpoint_url is null.
    const row = r.rows[0] as { endpoint_url: string | null; notification_webhook_url: string | null };
    const inference_source = row.endpoint_url ? 'seller_endpoint' : 'openx_hosted_llm';
    const advisories: string[] = [];
    if (!row.endpoint_url && row.notification_webhook_url) {
      advisories.push(
        'notification_webhook_url is set but endpoint_url is null — buyer queries are still answered by OpenX\'s LLM. To have YOUR endpoint answer queries, PATCH endpoint_url too.',
      );
    }
    res.json({ ...r.rows[0], inference_source, advisories });
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
     FROM agents WHERE published = true AND archived_at IS NULL ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  res.json(r.rows);
});

// Public — must be declared before /agents/:id so Express matches the
// literal /top instead of treating "top" as an :id. Whitelisted in
// middleware/auth.ts as `/^\/agents\/top$/`. Aggregates over the indexed
// `paid_calls.agent_id` (paid_calls_agent_idx, migration 010); cheap.
v3.get('/agents/top', async (req: Request, res: Response) => {
  const n = Math.min(Math.max(Number(req.query.n ?? 5), 1), 20);
  const windowDays = Math.min(Math.max(Number(req.query.window_days ?? 30), 1), 365);
  const r = await pool.query(
    `SELECT a.id,
            a.brain_id,
            a.chain,
            a.pricing,
            a.persona,
            a.slug,
            b.title,
            b.description,
            b.tags,
            COALESCE(stats.calls, 0)::int AS calls_30d
       FROM agents a
       JOIN brains b ON b.id = a.brain_id
  LEFT JOIN (
              SELECT agent_id, COUNT(*)::int AS calls
                FROM paid_calls
               WHERE created_at > now() - (INTERVAL '1 day' * $2)
            GROUP BY agent_id
            ) AS stats ON stats.agent_id = a.id
      WHERE a.published = true
   ORDER BY calls_30d DESC, a.created_at DESC
      LIMIT $1`,
    [n, windowDays],
  );
  res.json({ agents: r.rows, window_days: windowDays });
});

// /v3/agents/search — keyword fast-path. Public (whitelisted in auth.ts).
// Reads the cached Postgres TF-IDF corpus. Must be registered BEFORE the
// `/agents/:id` catch-all below or Express casts the literal "search" as a
// UUID and the route never matches.
v3.get('/agents/search', async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const limitN = Number(req.query.limit ?? 10);
  const kindRaw = typeof req.query.kind === 'string' ? req.query.kind : undefined;
  const allowedKinds = new Set(['api', 'workflow', 'skill', 'brain']);
  const kind = kindRaw && allowedKinds.has(kindRaw)
    ? (kindRaw as 'api' | 'workflow' | 'skill' | 'brain')
    : undefined;
  if (!q || q.trim().length === 0) {
    return res.status(400).json({ error: 'q is required' });
  }
  const result = await searchAgents({ q, limit: limitN, kind });
  res.json(result);
});

v3.get('/agents/:id', async (req: Request, res: Response) => {
  const r = await pool.query(
    `SELECT id, brain_id, owner_address, chain, persona, pricing, kya_required, min_reputation, published, slug, created_at
     FROM agents WHERE id = $1 AND archived_at IS NULL`,
    [req.params.id],
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'not found' });
  res.json(r.rows[0]);
});

v3.get('/agents/by-owner/:owner', async (req: Request, res: Response) => {
  const r = await pool.query(
    `SELECT id, brain_id, owner_address, chain, persona, pricing, kya_required, min_reputation, published, slug, created_at
     FROM agents WHERE owner_address = $1 AND archived_at IS NULL ORDER BY created_at DESC`,
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
  // Guard before any `WHERE id = $1` DB call: a non-UUID id would otherwise
  // throw at the driver and crash the process (unhandled). 404 = same shape
  // the not-found branch already returns below, so clients see one behaviour.
  if (!UUID_RE.test(id)) return res.status(404).json({ error: 'agent not found' });
  // Accept both `q` (legacy n-payment SDK convention) and `message` (the
  // /agent/[id] try button + most chat-style clients). Single source of
  // truth for the trimmed value below — old curl tests + the frontend
  // both work.
  const q = String(req.body?.q ?? req.body?.message ?? '').trim();
  if (!q || q.length > 2000) return res.status(400).json({ error: 'q or message required, ≤2000 chars' });

  // PRD-E unified dispatcher:
  //   • absent x-payment-tx → demo path (rate-limited, free, paid_calls.method='demo')
  //   • present x-payment-tx → paid path (skip rate limit, method='exact', amount from agent.pricing)
  // Same trust model as /v2/inference today — server records the claimed tx
  // verbatim; on-chain verification is an out-of-band audit job.
  const paymentTx =
    typeof req.headers['x-payment-tx'] === 'string'
      ? (req.headers['x-payment-tx'] as string).trim()
      : '';
  const payerAddr =
    typeof req.headers['x-payment-from'] === 'string'
      ? (req.headers['x-payment-from'] as string).toLowerCase()
      : '';
  const isPaid = paymentTx.length > 0;

  if (!isPaid) {
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
  }

  const r = await pool.query(
    `SELECT id, slug, brain_id, owner_address, persona, pricing FROM agents WHERE id = $1 AND published = true AND archived_at IS NULL`,
    [id],
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'agent not found' });
  const agent = r.rows[0];

  try {
    const { runInference } = await import('./v1Public');
    const { record } = await import('../services/paidCallLedger');
    const uploadIds = Array.isArray(req.body?.upload_ids)
      ? (req.body.upload_ids as unknown[])
          .filter((x): x is string => typeof x === 'string' && x.length > 0)
          .slice(0, 5) // hard cap per call — defends LLM context window + DB
      : [];
    const result = await runInference(
      { id: agent.id, brain_id: agent.brain_id, persona: agent.persona },
      q,
      uploadIds,
    );
    const txHash = isPaid ? paymentTx : `demo-${randomUUID()}`;
    const method = isPaid ? 'exact' : 'demo';
    const amountUsdc = isPaid
      ? String(agent.pricing?.x402 ?? '0.01')
      : '0';
    const buyer = isPaid ? (payerAddr || 'anonymous') : 'demo';
    await record({
      agentId: agent.id,
      slug: agent.slug ?? `agent-${agent.id}`,
      buyer,
      amountUsdc,
      txHash,
      network: process.env.X402_NETWORK ?? 'arbitrum-sepolia',
      method,
    });
    logger.info({ agentId: agent.id, paid: isPaid }, 'service:try:end');
    res.json({
      ...result,
      settled: { method, txHash, demo: !isPaid, amount_usdc: amountUsdc },
    });
  } catch (err) {
    logger.error({ agentId: agent.id, err: (err as Error).message }, 'service:try:failed');
    res.status(500).json({ error: 'inference failed' });
  }
});

// ─── PRD-E: workspace uploads + public recent-calls feed ───────────────────
//
// Both endpoints support the new /agent/:id/run workspace surface. They
// share the agent-lookup helper inline (pool.query is one-shot here, so
// no abstraction earns its keep). All limits enforced server-side; the
// client cannot bypass them by tweaking request bodies.

// Upload policy — single source of truth. Both 0 and negative env values mean
// "unlimited" (DB CHECK already enforces `size_bytes > 0`). The mint response
// echoes `max_bytes` so the frontend never has to hard-code the same number.
const UPLOAD_MAX_BYTES = Math.max(0, Number(process.env.UPLOAD_MAX_BYTES ?? 0));
const UPLOAD_MAX_PER_HOUR_PER_AGENT = Math.max(
  1,
  Number(process.env.UPLOAD_MAX_PER_HOUR_PER_AGENT ?? 100),
); // soft DoS guard — count, not size

// task_uploads table DDL kept inline so the route can self-heal when the
// production DB hasn't been migrated to 029 yet. Idempotent. Mirrors
// packages/shared/migrations/029_task_uploads.sql + 030_task_uploads_unlimited.
const TASK_UPLOADS_DDL = `
  CREATE TABLE IF NOT EXISTS task_uploads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    uploader_addr   TEXT NULL,
    storage_path    TEXT NOT NULL,
    original_name   TEXT NOT NULL,
    mime_type       TEXT NOT NULL,
    size_bytes      BIGINT NOT NULL CHECK (size_bytes > 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    consumed_at     TIMESTAMPTZ NULL,
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
  );
  CREATE INDEX IF NOT EXISTS task_uploads_agent_idx
    ON task_uploads(agent_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS task_uploads_expires_idx
    ON task_uploads(expires_at)
    WHERE consumed_at IS NULL;
`;
let _taskUploadsEnsured = false;

function sanitizeName(raw: string): string {
  // Strip path separators, collapse to a-zA-Z0-9._-, trim length.
  return (raw || 'file')
    .replace(/[\\/]/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80);
}

/**
 * POST /v3/agents/:id/uploads — mint a signed PUT URL for one workspace
 * file. The client uploads directly to Supabase Storage; the API never
 * proxies the bytes. Bucket + table are ensured idempotently on first call.
 *
 * Accepts any MIME type and any size > 0; operators can still cap size via
 * the UPLOAD_MAX_BYTES env (0 = unlimited, the default).
 *
 * Body: { original_name, mime_type?, size_bytes }
 * Resp: { upload_id, signed_url, storage_path, expires_in_sec, max_bytes }
 */
v3.post('/agents/:id/uploads', async (req: Request, res: Response) => {
  const id = req.params.id;
  const originalName = String(req.body?.original_name ?? '').trim();
  const mimeType = String(req.body?.mime_type ?? 'application/octet-stream').trim();
  const sizeBytes = Number(req.body?.size_bytes ?? 0);

  if (!originalName) return res.status(400).json({ error: 'original_name required' });
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return res.status(400).json({ error: 'size_bytes must be a positive number' });
  }
  if (UPLOAD_MAX_BYTES > 0 && sizeBytes > UPLOAD_MAX_BYTES) {
    return res.status(413).json({ error: `file exceeds ${UPLOAD_MAX_BYTES} bytes` });
  }
  // No MIME whitelist — accept everything. The bucket is private and signed
  // URLs are scoped per upload, so we don't need server-side type policing.

  // Validate agent + per-hour soft cap in one round-trip. Tolerate the
  // `task_uploads` table being absent on a not-yet-migrated DB by retrying
  // without the sub-query.
  let hourCount = 0;
  let agentRow: { id: string; published: boolean; archived_at: string | null } | null;
  try {
    const guard = await pool.query(
      `SELECT a.id, a.published, a.archived_at,
              (SELECT COUNT(*)::int FROM task_uploads u
                WHERE u.agent_id = a.id AND u.created_at > NOW() - INTERVAL '1 hour') AS hour_count
         FROM agents a WHERE a.id = $1`,
      [id],
    );
    agentRow = guard.rows[0] ?? null;
    hourCount = guard.rows[0]?.hour_count ?? 0;
  } catch (e) {
    if ((e as { code?: string }).code !== '42P01') throw e;
    // Table doesn't exist yet — first call after deploy. Fall back to plain
    // agent lookup; the table will be created in the try-block below.
    const fallback = await pool.query(
      `SELECT id, published, archived_at FROM agents WHERE id = $1`,
      [id],
    );
    agentRow = fallback.rows[0] ?? null;
  }
  if (!agentRow || !agentRow.published || agentRow.archived_at) {
    return res.status(404).json({ error: 'agent not found' });
  }
  if (hourCount >= UPLOAD_MAX_PER_HOUR_PER_AGENT) {
    return res.status(429).json({ error: 'agent upload cap reached, retry later' });
  }

  const uploadId = randomUUID();
  const safeName = sanitizeName(originalName);
  const storagePath = `${id}/${uploadId}/${safeName}`;
  const uploaderAddr =
    typeof req.body?.uploader_addr === 'string'
      ? req.body.uploader_addr.toLowerCase()
      : (req as AuthRequest).user?.address?.toLowerCase() ?? null;

  try {
    const { getTaskUploadsStorage } = await import('../services/supabaseStorage');
    const storage = getTaskUploadsStorage();
    // fileSizeLimit: undefined → no per-object cap at the bucket level.
    // ensureBucket also lifts the cap on a pre-existing bucket (see service).
    await storage.ensureBucket({ public: false, fileSizeLimit: undefined });
    const { signedUrl } = await storage.signedUploadUrl(storagePath);

    try {
      await pool.query(
        `INSERT INTO task_uploads (id, agent_id, uploader_addr, storage_path, original_name, mime_type, size_bytes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [uploadId, id, uploaderAddr, storagePath, originalName, mimeType, sizeBytes],
      );
    } catch (e) {
      // Table missing on a stale-migration deploy — create it once, retry once.
      if ((e as { code?: string }).code === '42P01' && !_taskUploadsEnsured) {
        logger.warn({ agentId: id }, 'v3:uploads:bootstrap-table');
        await pool.query(TASK_UPLOADS_DDL);
        _taskUploadsEnsured = true;
        await pool.query(
          `INSERT INTO task_uploads (id, agent_id, uploader_addr, storage_path, original_name, mime_type, size_bytes)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [uploadId, id, uploaderAddr, storagePath, originalName, mimeType, sizeBytes],
        );
      } else {
        throw e;
      }
    }

    res.json({
      upload_id: uploadId,
      signed_url: signedUrl,
      storage_path: storagePath,
      expires_in_sec: 60,
      max_bytes: UPLOAD_MAX_BYTES, // 0 = unlimited; client should treat as no cap
    });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    // STORAGE_UNCONFIGURED → operator hasn't provisioned Supabase Storage.
    // Surface a clear 503 so the workspace can show a useful message (the
    // inline path still works for text-y files ≤100 KB).
    if (e?.code === 'STORAGE_UNCONFIGURED') {
      logger.warn({ agentId: id, reason: e.message }, 'v3:uploads:disabled');
      return res.status(503).json({
        error: 'binary_uploads_disabled',
        message:
          'Binary uploads are not configured on this deploy. Text-y files (txt, md, csv, json, yaml, xml) up to 100 KB still work via the inline path. To enable larger / binary uploads, the operator must set SUPABASE_SERVICE_ROLE_KEY.',
      });
    }
    // Anything else: log + surface the underlying cause so ops can act on
    // it instead of staring at a generic "upload mint failed". `code` lets
    // Postgres errors (42P01, 23514, …) be diagnosed at a glance.
    logger.error({ agentId: id, err: e?.message, code: e?.code }, 'v3:uploads:failed');
    res.status(500).json({
      error: 'upload mint failed',
      message: e?.message ?? 'unknown error',
      code: e?.code ?? null,
    });
  }
});

// ─── public recent-calls feed (paid only, anonymized, 5s cache) ────────────
//
// Powers the right-column TX history on /agent/:id and /agent/:id/run.
// Rolling cache key = `agent:${id}:limit:${n}`. Cache TTL is small so the
// social-proof feed feels live without hitting Postgres on every poll.

interface RecentCallRow {
  tx_hash: string;
  payer: string;
  amount_usdc: string;
  status: 'success' | 'demo' | 'free';
  network: string;
  settled_at: string;
}

const recentCallsCache = new Map<
  string,
  { at: number; rows: RecentCallRow[] }
>();
const RECENT_CALLS_TTL_MS = 5_000;
const RECENT_CALLS_MAX_LIMIT = 50;

function anonAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr ?? '';
  if (addr === 'demo') return 'demo';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function methodToStatus(method: string): RecentCallRow['status'] {
  if (method === 'demo' || method === 'free') return method;
  return 'success'; // exact / fherc20 / any future paid rail
}

v3.get('/agents/:id/recent-calls', async (req: Request, res: Response) => {
  const id = req.params.id;
  const limit = Math.max(
    1,
    Math.min(RECENT_CALLS_MAX_LIMIT, Number(req.query.limit ?? 10) | 0),
  );
  const key = `${id}:${limit}`;
  const now = Date.now();
  const cached = recentCallsCache.get(key);
  if (cached && now - cached.at < RECENT_CALLS_TTL_MS) {
    res.set('Cache-Control', 'public, max-age=5');
    return res.json({ rows: cached.rows, cached: true });
  }

  const r = await pool.query(
    `SELECT tx_hash, buyer, amount_usdc::text AS amount_usdc, network, method, created_at
       FROM paid_calls
      WHERE agent_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [id, limit],
  );
  const rows: RecentCallRow[] = r.rows.map((row) => ({
    tx_hash: row.tx_hash,
    payer: anonAddr(row.buyer ?? ''),
    amount_usdc: row.amount_usdc,
    status: methodToStatus(row.method),
    network: row.network,
    settled_at: row.created_at,
  }));
  recentCallsCache.set(key, { at: now, rows });
  res.set('Cache-Control', 'public, max-age=5');
  res.json({ rows, cached: false });
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

  // Delegate to the existing inference path — single-tier (Fhenix on
  // Arbitrum) post-Sui-removal. Reuses the v2 chat service against the
  // agent's brain.
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
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const message = typeof body.message === 'string' ? body.message : '';
  const result = await discover({ ...body, message } as any, baseUrl);
  res.json(result);
});

// ---------------------------------------------------------------------------
// /v3/runner/:id — hosted runner SSE (T16). Optional path; manifest mode is canonical.
// ---------------------------------------------------------------------------

v3.post('/runner/:id', streamBundle as any);


// ---------------------------------------------------------------------------
// /v3/dashboard/stats — public cash-flow dashboard (Frame F1).
// Aggregates over paid_calls + cognitive_workflows + brains. SQL-only; cheap
// (<5 ms with the existing covering indexes). No auth required — the
// numbers are public marketing artifacts. Whitelisted in middleware/auth.ts.
// ---------------------------------------------------------------------------
v3.get('/dashboard/stats', async (_req: Request, res: Response) => {
  try {
    const [counts, topSellers, recentReceipts] = await Promise.all([
      pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM brains WHERE published = true)                            AS brains_published,
           (SELECT COUNT(*)::int FROM cognitive_workflows WHERE published = true)               AS workflows_published,
           (SELECT COUNT(*)::int FROM cognitive_workflow_runs)                                  AS workflow_runs_total,
           (SELECT COUNT(*)::int FROM cognitive_workflow_runs WHERE created_at >= now() - interval '24 hours') AS workflow_runs_24h,
           (SELECT COALESCE(SUM(amount_usdc), 0)::numeric(20,6) FROM paid_calls)                AS total_usdc_routed,
           (SELECT COALESCE(SUM(amount_usdc), 0)::numeric(20,6) FROM paid_calls WHERE created_at >= now() - interval '24 hours') AS usdc_routed_24h`,
      ),
      pool.query(
        `SELECT a.owner_address AS seller, SUM(pc.amount_usdc)::numeric(20,6) AS earned, COUNT(pc.id)::int AS calls
           FROM paid_calls pc JOIN agents a ON a.id = pc.agent_id
          GROUP BY a.owner_address
          ORDER BY earned DESC LIMIT 10`,
      ),
      pool.query(
        `SELECT slug, buyer, amount_usdc, tx_hash, network, method, created_at
           FROM paid_calls ORDER BY created_at DESC LIMIT 20`,
      ),
    ]);
    res.json({
      counts: counts.rows[0],
      topSellers: topSellers.rows,
      recentReceipts: recentReceipts.rows,
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'v3:dashboard:stats:failed');
    res.status(500).json({ error: 'stats-failed' });
  }
});

// ---------------------------------------------------------------------------
// Sub-routers (PRD-1 + PRD-2). Each is feature-flagged inside its own module;
// when the flag is off the routes return 404 — same envelope as if the
// router weren't mounted, so byte-identical rollback is just a flag flip.
// ---------------------------------------------------------------------------
import conciergeRouter from './v3-concierge';
import commRouter from './v3-comm';
// ---------------------------------------------------------------------------
// Seller-async delivery callback (PRD-2 seller-callback extension).
//
// When a seller's endpoint returns {status:"pending"} to dispatchToSelfHosted,
// OpenX parks a task in agent_tasks (status='running') and gives the seller
// a callback URL of the form:
//
//   POST /v3/agents/:agent_id/tasks/:external_task_id/deliver
//   Authorization: Bearer <task_token>           // HMAC issued by OpenX
//   Content-Type:  application/json
//   Body: { "answer": "...", "citations"?: number[], "artifacts"?: [...] }
//
// On success the row flips to status='complete' + buyers polling
// /api/v1/<slug>/tasks/<external_task_id> get the final answer + the
// existing inbox / notification fan-out fires (paid_call.completed already
// handled at settlement time; we add task.completed here).
//
// Whitelisted in auth.ts because the seller's box has no Privy session.
// HMAC bearer auth is the actual gate.
// ---------------------------------------------------------------------------
import { timingSafeEqual as _tsequal, createHmac as _hmac } from 'node:crypto';

v3.post('/agents/:agent_id/tasks/:external_task_id/deliver', async (req: Request, res: Response) => {
  const { agent_id, external_task_id } = req.params;
  if (!/^[a-zA-Z0-9]{8,64}$/.test(external_task_id)) {
    return res.status(400).json({ error: 'invalid_task_id' });
  }

  // 1. Lookup the parked task
  const rowQ = await pool.query<{
    id: string;
    agent_id: string;
    status: string;
    seller_task_token: string | null;
  }>(
    `SELECT id, agent_id, status, seller_task_token
       FROM agent_tasks
      WHERE external_task_id = $1
      LIMIT 1`,
    [external_task_id],
  );
  if ((rowQ.rowCount ?? 0) === 0) return res.status(404).json({ error: 'task_not_found' });
  const row = rowQ.rows[0];
  if (row.agent_id !== agent_id) return res.status(404).json({ error: 'task_not_found' });

  // 2. Verify HMAC bearer token (constant-time)
  const expected = row.seller_task_token ?? _hmac(
    'sha256',
    process.env.OPENX_WEBHOOK_SECRET ?? 'dev-only-webhook-secret-please-rotate',
  )
    .update(external_task_id)
    .digest('hex')
    .slice(0, 32);
  const header = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  if (header.length === 0 || header.length !== expected.length) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (!_tsequal(a, b)) return res.status(401).json({ error: 'unauthorized' });

  // 3. Idempotency — already delivered, return current state.
  if (row.status === 'complete' || row.status === 'failed') {
    return res.status(200).json({ ok: true, status: row.status, idempotent: true });
  }

  // 4. Validate body
  const { answer, citations, artifacts, error } = (req.body ?? {}) as {
    answer?: unknown;
    citations?: unknown;
    artifacts?: unknown;
    error?: unknown;
  };

  // Seller can also signal failure if their pipeline gave up.
  if (typeof error === 'string' && error.trim().length > 0) {
    await pool.query(
      `UPDATE agent_tasks
          SET status = 'failed', error_message = $2, completed_at = NOW()
        WHERE id = $1`,
      [row.id, error.slice(0, 1000)],
    );
    return res.status(200).json({ ok: true, status: 'failed' });
  }

  if (typeof answer !== 'string' || answer.trim().length === 0) {
    return res.status(400).json({ error: 'answer_required' });
  }

  // 5. Persist + complete
  const result = {
    answer,
    citations: Array.isArray(citations) ? citations.filter((n) => Number.isInteger(n)) : [],
    artifacts: Array.isArray(artifacts) ? artifacts : [],
    inference_source: 'seller_endpoint',
  };
  await pool.query(
    `UPDATE agent_tasks
        SET status = 'complete', result = $2::jsonb, completed_at = NOW()
      WHERE id = $1`,
    [row.id, JSON.stringify(result)],
  );
  logger.info({ external_task_id, agent_id }, 'seller-deliver:complete');
  res.status(200).json({ ok: true, status: 'complete' });
});

v3.use('/concierge', conciergeRouter);
v3.use('/', commRouter); // /threads, /inbox, /inbox/stream

// ---------------------------------------------------------------------------
// PRD-G — /v3/credits/me + /v3/credits/history
// ---------------------------------------------------------------------------
//
// Auth-gated by the parent `/v3` mount. Returns the buyer's current credit
// balance + welcome-grant status + paginated ledger.
//
// SOLID: this file owns the HTTP shape only. Balance / history reads are
// delegated to creditService — no raw SQL leaks into the route.

v3.get('/credits/me', async (req: AuthRequest, res: Response) => {
  const wallet = req.user?.address;
  if (!wallet) return res.status(401).json({ error: 'auth required' });
  const credits = await import('../services/creditService');
  if (!credits.isEnabled()) {
    return res.status(404).json({ error: 'credit system disabled' });
  }
  // ensureAccount is idempotent + lazy-grants welcome; safe to call here
  // on every /me read so the frontend can be the source of truth.
  const account = await credits.ensureAccount({ wallet_address: wallet });
  res.json({
    wallet,
    balance_usdc: account.balance_usdc,
    welcome_granted: account.welcome_granted,
    privy_bound: !!account.privy_user_id,
  });
});

v3.get('/credits/history', async (req: AuthRequest, res: Response) => {
  const wallet = req.user?.address;
  if (!wallet) return res.status(401).json({ error: 'auth required' });
  const credits = await import('../services/creditService');
  if (!credits.isEnabled()) {
    return res.status(404).json({ error: 'credit system disabled' });
  }
  const acc = await credits.getBalance(wallet);
  if (!acc) return res.json({ rows: [] });
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  const rows = await credits.listHistory(acc.id, { limit, offset });
  res.json({ rows, limit, offset });
});

// PRD-G — public read-only config for the browser top-up modal. The
// addresses + packs the frontend needs to build a USDC.transfer call.
// Public path (no wallet header required) — added to PUBLIC_PATHS in auth.ts.
v3.get('/credits/config', async (_req: Request, res: Response) => {
  res.json({
    enabled: process.env.FEATURE_CREDIT_SYSTEM === 'true',
    payout_address: process.env.PLATFORM_PAYOUT_ADDRESS ?? null,
    usdc_address:
      process.env.X402_USDC_ADDRESS ?? '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    chain_id: Number(process.env.X402_CHAIN_ID ?? '421614'),
    packs: String(process.env.CREDIT_TOPUP_PACKS ?? '25,50,100')
      .split(',')
      .map((n) => Number(n.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
  });
});

// PRD-G — browser top-up verify-and-credit. Buyer sends USDC to
// PLATFORM_PAYOUT_ADDRESS via viem/wagmi, then POSTs the tx_hash here.
// We verify the on-chain ERC-20 Transfer log (from, to, amount) and call
// creditService.grant(). Idempotent on UNIQUE(kind, tx_hash).
//
// Security: `from` MUST equal the authed wallet, so one buyer cannot
// claim another buyer's transfer. `to` MUST equal PLATFORM_PAYOUT_ADDRESS,
// and `value` MUST equal the requested pack exactly.
v3.post('/credits/topup', async (req: AuthRequest, res: Response) => {
  const wallet = req.user?.address;
  if (!wallet) return res.status(401).json({ error: 'auth required' });
  const credits = await import('../services/creditService');
  if (!credits.isEnabled()) return res.status(404).json({ error: 'credit system disabled' });

  const { tx_hash, pack_usdc } = (req.body ?? {}) as { tx_hash?: string; pack_usdc?: number };
  if (!tx_hash || typeof tx_hash !== 'string' || !pack_usdc) {
    return res.status(400).json({ error: 'tx_hash + pack_usdc required' });
  }
  const packs = String(process.env.CREDIT_TOPUP_PACKS ?? '25,50,100')
    .split(',')
    .map((n) => Number(n.trim()));
  if (!packs.includes(Number(pack_usdc))) {
    return res.status(400).json({ error: 'invalid_pack', valid: packs });
  }
  const payout = (process.env.PLATFORM_PAYOUT_ADDRESS ?? '').toLowerCase();
  if (!payout) return res.status(503).json({ error: 'payout_address_not_configured' });

  const { ethers } = await import('ethers');
  const rpc = process.env.ARBITRUM_SEPOLIA_RPC ?? 'https://sepolia-rollup.arbitrum.io/rpc';
  const usdcAddr = (process.env.X402_USDC_ADDRESS ??
    '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d').toLowerCase();
  const provider = new ethers.JsonRpcProvider(rpc);
  let receipt;
  try {
    receipt = await provider.getTransactionReceipt(tx_hash);
  } catch (err) {
    return res.status(502).json({ error: 'rpc_error', detail: (err as Error).message });
  }
  if (!receipt || receipt.status !== 1) {
    return res.status(400).json({ error: 'tx_not_found_or_failed' });
  }

  const transferTopic = ethers.id('Transfer(address,address,uint256)');
  const expected = ethers.parseUnits(String(pack_usdc), 6);
  let matched = false;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== usdcAddr) continue;
    if (log.topics[0] !== transferTopic) continue;
    const from = ('0x' + log.topics[1].slice(26)).toLowerCase();
    const to = ('0x' + log.topics[2].slice(26)).toLowerCase();
    const value = BigInt(log.data);
    if (from === wallet.toLowerCase() && to === payout && value === expected) {
      matched = true;
      break;
    }
  }
  if (!matched) {
    return res.status(400).json({
      error: 'transfer_not_matched',
      expected: { from: wallet, to: payout, amount: expected.toString() },
    });
  }

  const granted = await credits.grant({
    wallet_address: wallet,
    amount_usdc: Number(pack_usdc),
    kind: 'purchase',
    tx_hash,
    meta: { pack: pack_usdc, source: 'browser-topup' },
  });
  res.json({ ok: true, ...granted });
});

// ---------------------------------------------------------------------------
// Agent Training Pipeline v1.0 — kit registry + per-agent SKILL.md inventory.
// All 6 endpoints gated behind FEATURE_AGENT_TRAINING_PIPELINE. When the flag
// is off the router returns 501 for the whole namespace — byte-identical
// rollback because no other code path references these routes.
// ---------------------------------------------------------------------------

const trainingPipeline = new AgentTrainingService({ pool, logger });

function trainingEnabled(): boolean {
  return process.env.FEATURE_AGENT_TRAINING_PIPELINE === 'true';
}

function ownerAddress(req: AuthRequest): string | null {
  const header = (req.headers['x-wallet-address'] as string | undefined) ?? '';
  return req.user?.address ?? (header ? header.toLowerCase() : null);
}

function handleTrainingError(res: Response, err: unknown, tag: string): void {
  const e = err as Error & { status?: number; audit?: unknown };
  const status = e.status ?? 500;
  if (status >= 500) logger.error({ err: e.message, tag }, 'v3:training:error');
  else logger.warn({ err: e.message, tag }, 'v3:training:client-error');
  res.status(status).json({ error: e.message, ...(e.audit ? { audit: e.audit } : {}) });
}

v3.get('/kits', async (_req: Request, res: Response) => {
  if (!trainingEnabled()) return res.status(501).json({ error: 'feature_disabled' });
  try {
    const kits = await trainingPipeline.listKits();
    res.json({ kits });
  } catch (err) {
    handleTrainingError(res, err, 'kits:list');
  }
});

v3.get('/kits/:slug', async (req: Request, res: Response) => {
  if (!trainingEnabled()) return res.status(501).json({ error: 'feature_disabled' });
  try {
    const detail = await trainingPipeline.getKitBySlug(String(req.params.slug));
    if (!detail) return res.status(404).json({ error: 'kit_not_found' });
    res.json(detail);
  } catch (err) {
    handleTrainingError(res, err, 'kits:get');
  }
});

v3.get('/agents/:id/skills', async (req: Request, res: Response) => {
  if (!trainingEnabled()) return res.status(501).json({ error: 'feature_disabled' });
  try {
    const skills = await trainingPipeline.listAgentSkills(String(req.params.id));
    res.json({ skills });
  } catch (err) {
    handleTrainingError(res, err, 'skills:list');
  }
});

v3.post('/agents/:id/skills', async (req: AuthRequest, res: Response) => {
  if (!trainingEnabled()) return res.status(501).json({ error: 'feature_disabled' });
  const owner = ownerAddress(req);
  if (!owner) return res.status(401).json({ error: 'wallet_required' });
  const content = String(req.body?.skill_md_content ?? '');
  if (!content) return res.status(400).json({ error: 'skill_md_content required' });
  const kitSlugs = Array.isArray(req.body?.kit_slugs) ? (req.body.kit_slugs as string[]) : [];
  try {
    const out = await trainingPipeline.uploadAgentSkill(String(req.params.id), owner, {
      skill_md_content: content,
      kit_slugs: kitSlugs,
    });
    res.json(out);
  } catch (err) {
    handleTrainingError(res, err, 'skills:upload');
  }
});

v3.delete('/agents/:id/skills/:slug', async (req: AuthRequest, res: Response) => {
  if (!trainingEnabled()) return res.status(501).json({ error: 'feature_disabled' });
  const owner = ownerAddress(req);
  if (!owner) return res.status(401).json({ error: 'wallet_required' });
  try {
    const ok = await trainingPipeline.archiveAgentSkill(
      String(req.params.id),
      owner,
      String(req.params.slug),
    );
    if (!ok) return res.status(404).json({ error: 'skill_not_found_or_already_archived' });
    res.json({ ok: true });
  } catch (err) {
    handleTrainingError(res, err, 'skills:archive');
  }
});

v3.get('/agents/:id/introspect', async (req: Request, res: Response) => {
  if (!trainingEnabled()) return res.status(501).json({ error: 'feature_disabled' });
  try {
    const view = await trainingPipeline.introspectAgent(String(req.params.id));
    if (!view) return res.status(404).json({ error: 'agent_not_found' });
    res.json(view);
  } catch (err) {
    handleTrainingError(res, err, 'introspect');
  }
});

export default v3;
