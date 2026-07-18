/**
 * v3-marketplace — seller-first marketplace v1 + v2 routes.
 *
 *   Public (whitelisted in auth.ts):
 *     GET  /v3/marketplace/listings                  v1 catalog
 *     GET  /v3/marketplace/workflows                 v2 workflow catalog
 *     GET  /v3/marketplace/workflows/:slug           v2 workflow detail
 *     GET  /v3/marketplace/workflows/:slug/recent    v2 anonymized recent runs
 *
 *   Auth-gated:
 *     POST  /v3/marketplace/seller/publish           v1 atomic publish (now seller-aware)
 *     GET   /v3/marketplace/seller/me                v2 current seller profile
 *     PATCH /v3/marketplace/seller/me                v2 update profile
 *     GET   /v3/marketplace/seller/dashboard         v2 rolled-up earnings
 *     GET   /v3/marketplace/seller/dashboard.csv     v2 CSV export (streamed)
 *
 * SOLID:
 *   - SRP: this file owns marketplace HTTP. Business logic stays in
 *     `services/sellerPublishService.ts`. Aggregations live in this file
 *     because they are simple SQL — no separate service warranted.
 *   - DIP: pool is module-level (matches the rest of routes/*).
 */

import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../lib';
import type { AuthRequest } from '../middleware/auth';
import { publish, type SellerPublishInput } from '../services/sellerPublishService';
import type { TrustlineCheckResult, XrplSendResult } from '../services/xrplPayoutService';

const router = Router();

const VALID_DOMAINS = new Set([
  'marketing',
  'finance',
  'research',
  'engineering',
  'generalist',
  'other',
]);
const VALID_TIERS = new Set(['basic', 'verified', 'tee_attested']);
const VALID_KINDS = new Set(['api', 'workflow', 'skill', 'brain', 'public']);

// ─── Public catalog ────────────────────────────────────────────────────────

router.get('/listings', async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 100);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  const domain =
    typeof req.query.domain === 'string' && VALID_DOMAINS.has(req.query.domain)
      ? req.query.domain
      : null;
  const tier =
    typeof req.query.tier === 'string' && VALID_TIERS.has(req.query.tier)
      ? req.query.tier
      : null;
  const kind =
    typeof req.query.kind === 'string' && VALID_KINDS.has(req.query.kind)
      ? req.query.kind
      : null;

  const params: Array<string | number> = [limit, offset];
  let where = `WHERE a.published = true AND a.archived_at IS NULL`;
  if (domain) {
    params.push(domain);
    where += ` AND a.domain = $${params.length}`;
  }
  if (tier) {
    params.push(tier);
    where += ` AND a.verification_tier = $${params.length}`;
  }
  if (kind) {
    params.push(kind);
    where += ` AND a.kind = $${params.length}`;
  }

  const r = await pool.query(
    `SELECT a.id, a.brain_id, a.slug, a.chain, a.domain, a.short_description,
            a.verification_tier, a.kind, a.privacy_mode, a.privacy_source,
            a.pricing, a.persona, a.created_at,
            b.title, b.description, b.tags
       FROM agents a
       LEFT JOIN brains b ON b.id = a.brain_id
       ${where}
   ORDER BY a.created_at DESC
      LIMIT $1 OFFSET $2`,
    params,
  );
  res.json({ listings: r.rows, limit, offset });
});

// ─── Public workflow catalog (PRD-15) ──────────────────────────────────────

router.get('/workflows', async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 100);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  const r = await pool.query(
    `SELECT a.slug, a.short_description, a.domain, a.verification_tier,
            a.privacy_mode, a.kind, a.workflow_ref, a.created_at,
            b.title, b.description,
            cw.steps, cw.default_price_usdc, cw.runs, cw.successful_runs
       FROM agents a
       JOIN brains b ON b.id = a.brain_id
       LEFT JOIN cognitive_workflows cw
              ON cw.author_addr = a.owner_address
             AND cw.workflow_key = a.workflow_ref
      WHERE a.published = true AND a.archived_at IS NULL AND a.kind = 'workflow'
   ORDER BY a.created_at DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  res.json({ listings: r.rows, limit, offset });
});

router.get('/workflows/:slug', async (req: Request, res: Response) => {
  const slug = String(req.params.slug ?? '').toLowerCase();
  const r = await pool.query(
    `SELECT a.id, a.slug, a.owner_address, a.short_description, a.domain,
            a.verification_tier, a.privacy_mode, a.privacy_source,
            a.pricing, a.persona, a.manifest_yaml, a.workflow_ref, a.created_at,
            b.title, b.description, b.tags,
            cw.steps, cw.default_price_usdc, cw.author_bps, cw.platform_bps,
            cw.runs, cw.successful_runs
       FROM agents a
       JOIN brains b ON b.id = a.brain_id
       LEFT JOIN cognitive_workflows cw
              ON cw.author_addr = a.owner_address
             AND cw.workflow_key = a.workflow_ref
      WHERE a.published = true AND a.archived_at IS NULL AND a.kind = 'workflow' AND a.slug = $1
      LIMIT 1`,
    [slug],
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'workflow not found' });
  res.json(r.rows[0]);
});

router.get('/workflows/:slug/recent', async (req: Request, res: Response) => {
  const slug = String(req.params.slug ?? '').toLowerCase();
  const limit = Math.min(Math.max(Number(req.query.limit ?? 5), 1), 25);
  const r = await pool.query(
    `SELECT cwr.id, cwr.success, cwr.outputs_hash, cwr.total_usdc,
            cwr.attestation_hash, cwr.started_at, cwr.ended_at
       FROM cognitive_workflow_runs cwr
       JOIN cognitive_workflows cw ON cw.id = cwr.workflow_id
       JOIN agents a ON a.workflow_ref = cw.workflow_key AND a.owner_address = cw.author_addr
      WHERE a.slug = $1
   ORDER BY cwr.created_at DESC
      LIMIT $2`,
    [slug, limit],
  );
  res.json({ runs: r.rows });
});

// POST /workflows/:slug/run — auth-gated. Phase 2 wires execution into the
// existing v1Public/x402 paywall; for now the route returns a structured
// 503 so callers (UI + MCP) get a deterministic envelope instead of a
// silent 404.
router.post('/workflows/:slug/run', async (req: AuthRequest, res: Response) => {
  if (!req.user?.address) return res.status(401).json({ error: 'auth required' });
  const slug = String(req.params.slug ?? '').toLowerCase();
  const r = await pool.query(
    `SELECT a.id AS agent_id
       FROM agents a
      WHERE a.slug = $1 AND a.published = true AND a.kind = 'workflow'
      LIMIT 1`,
    [slug],
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'workflow not found' });
  res.status(503).json({
    error: 'workflow execution coming soon',
    hint: 'Workflows can be published and listed today; execution lands in Phase 2.',
  });
});

// ─── Auth-gated seller surface (PRD-14) ────────────────────────────────────

router.post('/seller/publish', async (req: AuthRequest, res: Response) => {
  if (!req.user?.address) return res.status(401).json({ error: 'auth required' });
  try {
    const apiBaseUrl = `${req.protocol}://${req.get('host')}`;
    const result = await publish(req.user.address, req.body as SellerPublishInput, {
      apiBaseUrl,
      permitJti: req.user.permitJti ?? null,
      permitExpSec: req.user.permitExpSec,
    });
    logger.info(
      {
        wallet: req.user.address,
        slug: result.slug,
        domain: result.domain,
        kind: result.kind,
        chain: result.chain,
        privacy_mode: result.privacy_mode,
        seller_id: result.seller_id,
      },
      'marketplace:seller:publish:ok',
    );
    res.json(result);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    const status = typeof err?.status === 'number' ? err.status : 500;
    logger.warn(
      { wallet: req.user.address, err: err?.message, status },
      'marketplace:seller:publish:failed',
    );
    res.status(status).json({ error: err?.message ?? 'publish failed' });
  }
});

// ─── PRD-19 — gasless on-chain registration status (public read) ───────────
//
// Frontend dashboard polls this every 5s after a publish to flip the
// "Live on-chain" badge. Public-by-default: returns only state + the
// transaction hash + the registry brain id, all of which are already
// queryable directly on Arbitrum Sepolia. No private data leaks.
//
// Returns {state:'none'} when no queue row exists (gasless flag was off
// at publish time) so the frontend can render "off-chain only" without
// a special 404 path.
router.get('/seller/agent/:id/onchain-status', async (req: Request, res: Response) => {
  const agentId = String(req.params.id ?? '');
  // UUID-v4 shape check — cheap, prevents SQL probing.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentId)) {
    return res.status(400).json({ error: 'invalid agent id' });
  }
  const r = await pool.query(
    `SELECT state, tx_hash, on_chain_brain_id, attempts, last_error
       FROM chain_ops_queue
      WHERE agent_id = $1
      ORDER BY id DESC
      LIMIT 1`,
    [agentId],
  );
  if (r.rowCount === 0) {
    return res.json({ state: 'none', tx_hash: null, on_chain_brain_id: null, attempts: 0, error: null });
  }
  const row = r.rows[0];
  res.json({
    state: row.state,
    tx_hash: row.tx_hash,
    on_chain_brain_id: row.on_chain_brain_id !== null ? Number(row.on_chain_brain_id) : null,
    attempts: Number(row.attempts),
    error: row.last_error,
  });
});

router.get('/seller/me', async (req: AuthRequest, res: Response) => {
  if (!req.user?.address) return res.status(401).json({ error: 'auth required' });
  const owner = req.user.address.toLowerCase();
  const r = await pool.query(
    `SELECT id, wallet_address, display_name, bio, identity_type, identity_handle,
            kya_proof_id, kya_min_reputation, payout_method, xrpl_address,
            contact_email, support_url, archived, created_at, updated_at
       FROM sellers WHERE wallet_address = $1`,
    [owner],
  );
  if (r.rowCount === 0) return res.json({ seller: null });
  res.json({ seller: r.rows[0] });
});

router.patch('/seller/me', async (req: AuthRequest, res: Response) => {
  if (!req.user?.address) return res.status(401).json({ error: 'auth required' });
  const owner = req.user.address.toLowerCase();
  const body = (req.body ?? {}) as Record<string, unknown>;
  const allowed = [
    'display_name',
    'bio',
    'identity_type',
    'identity_handle',
    'contact_email',
    'support_url',
    'xrpl_address',
  ];
  const fields = allowed.filter((k) => body[k] !== undefined);
  if (fields.length === 0) return res.status(400).json({ error: 'no updatable fields' });

  // Self-reported, unverified (Q6) — soft format check only, no signature
  // challenge. Rejects obviously-wrong input without pretending to verify
  // ownership.
  if (body.xrpl_address !== undefined && body.xrpl_address !== null) {
    const addr = String(body.xrpl_address);
    if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(addr)) {
      return res.status(400).json({ error: 'invalid_xrpl_address', hint: 'Expected an XRPL classic address starting with r.' });
    }
  }

  const sets = fields.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const params: Array<unknown> = [owner, ...fields.map((k) => body[k])];
  await pool.query(
    `INSERT INTO sellers (wallet_address, ${fields.join(', ')}, created_at, updated_at)
     VALUES ($1, ${fields.map((_, i) => `$${i + 2}`).join(', ')}, now(), now())
     ON CONFLICT (wallet_address) DO UPDATE SET ${sets}, updated_at = now()`,
    params,
  );
  res.json({ ok: true });
});

router.get('/seller/dashboard', async (req: AuthRequest, res: Response) => {
  if (!req.user?.address) return res.status(401).json({ error: 'auth required' });
  const owner = req.user.address.toLowerCase();
  const sellerRow = await pool.query(`SELECT id FROM sellers WHERE wallet_address = $1`, [owner]);
  const sellerId = sellerRow.rowCount === 0 ? null : sellerRow.rows[0].id;
  // Optional network selector for credit_balance (Q9/PRD-Y) — defaults to
  // Arbitrum so every existing caller is byte-identical.
  const balanceNetwork = req.query.network === 'xrpl-testnet' ? 'xrpl-testnet' : 'arbitrum-sepolia';

  // Query agents by owner_address — broader than seller_id so legacy v1
  // brains (no sellers row) still surface in the Studio creator tab.
  // Includes a.brain_id so the frontend can match every brain↔agent pair
  // and resolve the agent UUID for the per-row Hide/Restore actions.
  const [agents, archived, earnings] = await Promise.all([
    pool.query(
      `SELECT a.id, a.brain_id, a.slug, a.kind, a.domain, a.verification_tier, a.privacy_mode,
              a.created_at,
              COALESCE(SUM(pc.amount_usdc), 0)::text AS earned_total,
              COUNT(pc.id)::int                      AS calls_total
         FROM agents a
         LEFT JOIN paid_calls pc ON pc.agent_id = a.id
        WHERE LOWER(a.owner_address) = $1 AND a.archived_at IS NULL
     GROUP BY a.id
     ORDER BY a.created_at DESC`,
      [owner],
    ),
    pool.query(
      `SELECT a.id, a.brain_id, a.slug, a.kind, a.domain, a.verification_tier, a.privacy_mode,
              a.created_at, a.archived_at,
              COALESCE(SUM(pc.amount_usdc), 0)::text AS earned_total,
              COUNT(pc.id)::int                      AS calls_total,
              b.title AS title
         FROM agents a
         JOIN brains b ON b.id = a.brain_id
         LEFT JOIN paid_calls pc ON pc.agent_id = a.id
        WHERE LOWER(a.owner_address) = $1 AND a.archived_at IS NOT NULL
     GROUP BY a.id, b.title
     ORDER BY a.archived_at DESC`,
      [owner],
    ),
    pool.query(
      `SELECT
         COALESCE(SUM(pc.amount_usdc) FILTER (WHERE pc.created_at > now() - interval '7 days'), 0)::text  AS last_7d,
         COALESCE(SUM(pc.amount_usdc) FILTER (WHERE pc.created_at > now() - interval '30 days'), 0)::text AS last_30d,
         COALESCE(SUM(pc.amount_usdc), 0)::text                                                            AS all_time,
         COUNT(*) FILTER (WHERE pc.created_at > now() - interval '7 days')                                 AS calls_7d
       FROM paid_calls pc
       JOIN agents a ON a.id = pc.agent_id
      WHERE LOWER(a.owner_address) = $1`,
      [owner],
    ),
  ]);

  res.json({
    seller_id: sellerId,
    agents: agents.rows,
    archived_agents: archived.rows,
    earnings: earnings.rows[0] ?? { last_7d: '0', last_30d: '0', all_time: '0', calls_7d: 0 },
    credit_balance: sellerId !== null
      ? await (await import('../services/creditService')).getSellerBalance(Number(sellerId), balanceNetwork)
      : null,
  });
});

router.get('/seller/dashboard.csv', async (req: AuthRequest, res: Response) => {
  if (!req.user?.address) return res.status(401).json({ error: 'auth required' });
  const owner = req.user.address.toLowerCase();
  const sellerRow = await pool.query(`SELECT id FROM sellers WHERE wallet_address = $1`, [owner]);
  if (sellerRow.rowCount === 0) return res.status(404).send('no seller');
  const sellerId = sellerRow.rows[0].id;

  res.setHeader('content-type', 'text/csv');
  res.setHeader('content-disposition', `attachment; filename="seller-${sellerId}-audit.csv"`);
  res.write('agent_slug,kind,buyer,amount_usdc,rail,tx_hash,created_at\n');
  const r = await pool.query(
    `SELECT a.slug, a.kind, pc.buyer, pc.amount_usdc, pc.method, pc.tx_hash, pc.created_at
       FROM paid_calls pc
       JOIN agents a ON a.id = pc.agent_id
      WHERE a.seller_id = $1
   ORDER BY pc.created_at DESC`,
    [sellerId],
  );
  for (const row of r.rows) {
    res.write(
      `${row.slug},${row.kind},${row.buyer},${row.amount_usdc},${row.method},${row.tx_hash},${row.created_at.toISOString?.() ?? row.created_at}\n`,
    );
  }
  res.end();
});

// ─── PRD-21 — soft archive + restore + buyer task history ───────────────
//
// Archive is a marketplace-visibility flag, not a hard delete. Buyer
// receipts in `paid_calls` (FK to `agents.id` ON DELETE CASCADE) keep
// resolving because the row stays. Restore is one UPDATE.
//
// Ownership is enforced inline in the WHERE clause — `id = $1 AND
// owner_address = $2` — so a wrong-owner DELETE returns 0 rows updated
// → 404, with no separate fetch+check round trip.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.delete('/seller/agent/:id', async (req: AuthRequest, res: Response) => {
  if (!req.user?.address) return res.status(401).json({ error: 'auth required' });
  const id = String(req.params.id ?? '');
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid agent id' });
  const owner = req.user.address.toLowerCase();
  const r = await pool.query(
    `UPDATE agents
        SET archived_at = now(), published = false
      WHERE id = $1 AND LOWER(owner_address) = $2 AND archived_at IS NULL
      RETURNING id, archived_at`,
    [id, owner],
  );
  if (r.rowCount === 0) {
    return res.status(404).json({ error: 'agent not found or already hidden' });
  }
  logger.info({ wallet: owner, agentId: id, action: 'archive' }, 'marketplace:agent:archived');
  res.json({ ok: true, archived_at: r.rows[0].archived_at });
});

router.post('/seller/agent/:id/restore', async (req: AuthRequest, res: Response) => {
  if (!req.user?.address) return res.status(401).json({ error: 'auth required' });
  const id = String(req.params.id ?? '');
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid agent id' });
  const owner = req.user.address.toLowerCase();
  const r = await pool.query(
    `UPDATE agents
        SET archived_at = NULL, published = true
      WHERE id = $1 AND LOWER(owner_address) = $2 AND archived_at IS NOT NULL
      RETURNING id`,
    [id, owner],
  );
  if (r.rowCount === 0) {
    return res.status(404).json({ error: 'agent not found or already active' });
  }
  logger.info({ wallet: owner, agentId: id, action: 'restore' }, 'marketplace:agent:restored');
  res.json({ ok: true, restored: true });
});

router.post('/seller/archive-all', async (req: AuthRequest, res: Response) => {
  if (!req.user?.address) return res.status(401).json({ error: 'auth required' });
  const owner = req.user.address.toLowerCase();
  // Brain-keyed semantics: a "Hide all" hides every assistant the wallet
  // owns — both v2 marketplace agents (archive the agent row) AND v1
  // legacy brains without an agents row (flip brains.published=false).
  // One owner, two parallel UPDATEs in one transaction.
  const client = await pool.connect();
  let archived_count = 0;
  let unpublished_brains = 0;
  try {
    await client.query('BEGIN');
    const a = await client.query(
      `UPDATE agents
          SET archived_at = now(), published = false
        WHERE LOWER(owner_address) = $1 AND archived_at IS NULL`,
      [owner],
    );
    archived_count = a.rowCount ?? 0;
    const b = await client.query(
      `UPDATE brains
          SET published = false
        WHERE LOWER(owner_address) = $1 AND published = true`,
      [owner],
    );
    unpublished_brains = b.rowCount ?? 0;
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  logger.info(
    { wallet: owner, archived_count, unpublished_brains, action: 'archive-all' },
    'marketplace:agent:archive-all',
  );
  res.json({ ok: true, archived_count, unpublished_brains });
});

// ─── PRD-22 — brain-keyed Hide flow ──────────────────────────────────────
//
// A "brain" is the user's mental model of an assistant. Hide should flip
// `brains.published = false` and cascade-archive any agents wrapping that
// brain. Restore is the inverse. Works uniformly for both v1 brains
// (no agent row) and v2 marketplace listings (with agent row).
//
// SOLID: one transaction, two UPDATEs scoped by ownership in the WHERE
// clause. Wrong-owner returns 0 rows updated → 404, no separate fetch.

const BRAIN_ID_RE = /^[1-9][0-9]{0,9}$/;

router.delete('/seller/brain/:brainId', async (req: AuthRequest, res: Response) => {
  if (!req.user?.address) return res.status(401).json({ error: 'auth required' });
  const brainId = String(req.params.brainId ?? '');
  if (!BRAIN_ID_RE.test(brainId)) return res.status(400).json({ error: 'invalid brain id' });
  const owner = req.user.address.toLowerCase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const b = await client.query(
      `UPDATE brains SET published = false
        WHERE id = $1 AND LOWER(owner_address) = $2 AND published = true
        RETURNING id`,
      [brainId, owner],
    );
    if (b.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'assistant not found or already hidden' });
    }
    await client.query(
      `UPDATE agents
          SET archived_at = now(), published = false
        WHERE brain_id = $1 AND LOWER(owner_address) = $2 AND archived_at IS NULL`,
      [brainId, owner],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  logger.info({ wallet: owner, brainId, action: 'hide-brain' }, 'marketplace:brain:hidden');
  res.json({ ok: true, hidden_at: new Date().toISOString() });
});

router.post('/seller/brain/:brainId/restore', async (req: AuthRequest, res: Response) => {
  if (!req.user?.address) return res.status(401).json({ error: 'auth required' });
  const brainId = String(req.params.brainId ?? '');
  if (!BRAIN_ID_RE.test(brainId)) return res.status(400).json({ error: 'invalid brain id' });
  const owner = req.user.address.toLowerCase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const b = await client.query(
      `UPDATE brains SET published = true
        WHERE id = $1 AND LOWER(owner_address) = $2 AND published = false
        RETURNING id`,
      [brainId, owner],
    );
    if (b.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'assistant not found or already active' });
    }
    await client.query(
      `UPDATE agents
          SET archived_at = NULL, published = true
        WHERE brain_id = $1 AND LOWER(owner_address) = $2 AND archived_at IS NOT NULL`,
      [brainId, owner],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  logger.info({ wallet: owner, brainId, action: 'restore-brain' }, 'marketplace:brain:restored');
  res.json({ ok: true, restored: true });
});

// ─── PRD-21 §4 — buyer task history (auth-derived; no :address in URL) ───

router.get('/buyer/me/tasks', async (req: AuthRequest, res: Response) => {
  if (!req.user?.address) return res.status(401).json({ error: 'auth required' });
  const buyer = req.user.address.toLowerCase();
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 100);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);

  const [tasks, totals] = await Promise.all([
    pool.query(
      `SELECT pc.id, pc.slug, pc.amount_usdc, pc.tx_hash, pc.network, pc.method, pc.created_at,
              a.id AS agent_id, COALESCE(b.title, a.slug) AS agent_title
         FROM paid_calls pc
         JOIN agents a ON a.id = pc.agent_id
    LEFT JOIN brains b ON b.id = a.brain_id
        WHERE pc.buyer = $1
     ORDER BY pc.created_at DESC
        LIMIT $2 OFFSET $3`,
      [buyer, limit, offset],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS task_count,
              COALESCE(SUM(amount_usdc), 0)::text AS total_spent_usdc
         FROM paid_calls WHERE buyer = $1`,
      [buyer],
    ),
  ]);

  res.json({
    tasks: tasks.rows,
    task_count: totals.rows[0]?.task_count ?? 0,
    total_spent_usdc: totals.rows[0]?.total_spent_usdc ?? '0',
    limit,
    offset,
  });
});

// ─── PRD-G — seller withdraw ────────────────────────────────────────────
//
// Reads the seller's withdrawable balance, validates threshold + cooldown,
// signs an ERC-20 USDC `transfer` from PLATFORM_PAYOUT_PRIVATE_KEY (falls
// back to PLATFORM_SIGNER_PRIVATE_KEY) on Arbitrum Sepolia, and books the
// result via creditService.markPayout — all on success.
//
// SOLID:
//   * SRP — this handler orchestrates the steps; it doesn't own balance
//     mutation (creditService) or chain config (env).
//   * Idempotency — credit_ledger UNIQUE(kind, tx_hash) makes retries safe.

router.post('/seller/withdraw', async (req: AuthRequest, res: Response) => {
  if (!req.user?.address) return res.status(401).json({ error: 'auth required' });
  if (process.env.FEATURE_CREDIT_SYSTEM !== 'true') {
    return res.status(404).json({ error: 'credit system disabled' });
  }
  const owner = req.user.address.toLowerCase();
  const sellerRow = await pool.query(
    `SELECT id, xrpl_address FROM sellers WHERE wallet_address = $1`,
    [owner],
  );
  if (sellerRow.rowCount === 0) return res.status(404).json({ error: 'no seller profile' });
  const sellerId = Number(sellerRow.rows[0].id);
  const sellerXrplAddress = sellerRow.rows[0].xrpl_address as string | null;

  // Network selector (Q3/Q8): defaults to Arbitrum so every existing caller
  // is byte-identical. 'xrpl-testnet' is the only additive option — gated
  // separately below by XRPL_RLUSD_ENABLED.
  const network = (req.query.network as string | undefined) === 'xrpl-testnet' ? 'xrpl-testnet' : 'arbitrum-sepolia';

  const credits = await import('../services/creditService');
  const bal = await credits.getSellerBalance(sellerId, network);
  const withdrawable = Number(bal.withdrawable_usdc);

  const minWithdraw = Number(
    network === 'xrpl-testnet'
      ? process.env.SELLER_WITHDRAW_MIN_RLUSD ?? '5'
      : process.env.SELLER_WITHDRAW_MIN_USDC ?? '5',
  );
  if (withdrawable < minWithdraw) {
    return res.status(400).json({
      error: 'below_minimum',
      withdrawable_usdc: bal.withdrawable_usdc,
      minimum_usdc: String(minWithdraw),
      network,
    });
  }
  const cooldownSec = Number(process.env.SELLER_WITHDRAW_COOLDOWN_SECONDS ?? '300');
  if (bal.last_withdraw_at) {
    const elapsed = (Date.now() - new Date(bal.last_withdraw_at).getTime()) / 1000;
    if (elapsed < cooldownSec) {
      return res.status(429).json({
        error: 'cooldown_active',
        retry_after_seconds: Math.ceil(cooldownSec - elapsed),
      });
    }
  }

  // ─── XRPL-testnet branch (additive, Q3) ──────────────────────────────
  // Fail-fast on missing address / missing trustline (Q5, Q6) — never
  // attempts a send that's doomed to fail on-chain.
  if (network === 'xrpl-testnet') {
    if (process.env.XRPL_RLUSD_ENABLED !== 'true') {
      return res.status(404).json({ error: 'xrpl rail disabled' });
    }
    if (!sellerXrplAddress) {
      return res.status(400).json({
        error: 'xrpl_address_not_set',
        hint: 'Set your XRPL address in Studio → Wallet settings before withdrawing on XRPL testnet.',
      });
    }
    const xrplPayout = await import('../services/xrplPayoutService') as typeof import('../services/xrplPayoutService');
    const trustlineCheck: TrustlineCheckResult = await xrplPayout.checkTrustline(sellerXrplAddress);
    if (trustlineCheck.ok === false) {
      logger.warn({ seller_id: sellerId, reason: trustlineCheck.reason }, 'seller:withdraw:xrpl:trustline_check_failed');
      return res.status(503).json({ error: 'xrpl_not_configured', detail: trustlineCheck.detail });
    }
    if (!trustlineCheck.hasTrustline) {
      return res.status(400).json({
        error: 'seller_no_trustline',
        hint: 'Create an RLUSD trust line on your XRPL wallet before withdrawing.',
      });
    }

    const sendResult: XrplSendResult = await xrplPayout.sendRlusd(sellerXrplAddress, withdrawable);
    if (sendResult.ok === false) {
      logger.error({ seller_id: sellerId, reason: sendResult.reason, detail: sendResult.detail }, 'seller:withdraw:xrpl:failed');
      return res.status(sendResult.reason === 'not_configured' ? 503 : 500).json({
        error: sendResult.reason === 'not_configured' ? 'payout_not_configured' : 'xrpl_transfer_failed',
        detail: sendResult.detail,
      });
    }

    await credits.markPayout({
      seller_id: sellerId,
      seller_wallet_address: owner,
      amount_usdc: withdrawable,
      tx_hash: sendResult.tx_hash,
      network: 'xrpl-testnet',
    });

    logger.info(
      { seller_id: sellerId, xrpl_address: sellerXrplAddress, amount: withdrawable, tx_hash: sendResult.tx_hash },
      'seller:withdraw:xrpl:ok',
    );
    return res.json({
      ok: true,
      amount_usdc: withdrawable.toFixed(6),
      tx_hash: sendResult.tx_hash,
      network: 'xrpl-testnet',
    });
  }

  // ─── Arbitrum/USDC branch (existing, untouched) ──────────────────────
  // On-chain transfer (ethers v6).
  const { ethers } = await import('ethers');
  const rpc = process.env.ARBITRUM_SEPOLIA_RPC ?? 'https://sepolia-rollup.arbitrum.io/rpc';
  const usdcAddr = process.env.X402_USDC_ADDRESS ?? '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d';
  const payoutKey = process.env.PLATFORM_PAYOUT_PRIVATE_KEY ?? process.env.PLATFORM_SIGNER_PRIVATE_KEY;
  if (!payoutKey) {
    logger.warn('seller:withdraw: no payout key configured');
    return res.status(503).json({ error: 'payout_not_configured' });
  }
  try {
    const provider = new ethers.JsonRpcProvider(rpc);
    const wallet = new ethers.Wallet(payoutKey, provider);
    const usdc = new ethers.Contract(
      usdcAddr,
      ['function transfer(address to, uint256 amount) returns (bool)'],
      wallet,
    );
    // USDC has 6 decimals on Arbitrum Sepolia.
    const amountUnits = ethers.parseUnits(withdrawable.toFixed(6), 6);
    const tx = await usdc.transfer(owner, amountUnits);
    const receipt = await tx.wait();
    const txHash = (receipt?.hash ?? tx.hash) as string;

    await credits.markPayout({
      seller_id: sellerId,
      seller_wallet_address: owner,
      amount_usdc: withdrawable,
      tx_hash: txHash,
    });

    logger.info(
      { seller_id: sellerId, wallet: owner, amount: withdrawable, tx_hash: txHash },
      'seller:withdraw:ok',
    );
    res.json({
      ok: true,
      amount_usdc: withdrawable.toFixed(6),
      tx_hash: txHash,
      network: process.env.X402_NETWORK ?? 'arbitrum-sepolia',
    });
  } catch (err) {
    logger.error({ err: (err as Error).message, seller_id: sellerId }, 'seller:withdraw:failed');
    res.status(500).json({ error: 'on_chain_transfer_failed', detail: (err as Error).message });
  }
});

export default router;
