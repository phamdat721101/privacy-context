/**
 * /api/v1 — public, x402-paywalled brain endpoints.
 *
 * Per PRD-1:
 *   - GET /api/v1/<slug>                     → 402 → settle → 200 { answer, citations[] }
 *   - GET /api/v1/<slug>/.well-known/agent.json → AgentCard for n-payment auto-discovery
 *
 * Mounted WITHOUT parent auth: the paywall IS the auth.
 *
 * SOLID:
 *   - SRP: this module owns the public-API surface only. Inference, settlement,
 *     and ledger writes are delegated.
 *   - DIP: each agent's n-payment provider is built from agent config; we don't
 *     hard-code price/wallet/method anywhere.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { pool } from '../db';
import { logger } from '../lib';
import { llmChat } from '../services/chat';
import { rankChunks } from '../services/rag';
import { KnowledgeIngestService } from '../services/knowledge-ingest';
import * as ledger from '../services/paidCallLedger';
import { verifyFherc20Receipt } from '../services/fherc20Verifier';

const router = express.Router();

// ─── canonical system-prompt merger ────────────────────────────────────────
//
// Both `/api/v1/<slug>` (this file) and `/v3/agents/:id/chat` (routes/v3.ts)
// build the LLM system prompt the same way: optional seller-authored prompt
// from `persona.system_prompt`, followed by the RAG-derived grounding block.
// Centralizing here removes a latent drift bug where v3 chat templated
// `${persona.system_prompt}\n\nUser:…` (rendering "undefined" when unset)
// while v1Public used RAG-only and ignored the seller prompt entirely.
//
// Pure: no I/O, no side effects.
export function buildSystemPrompt(
  persona: { system_prompt?: string | null } | null | undefined,
  ragContext: string,
): string {
  const sellerPrompt = (persona?.system_prompt ?? '').trim();
  const grounding = ragContext
    ? `Answer using ONLY this knowledge:\n${ragContext}`
    : `No knowledge available; respond honestly that the brain is empty.`;
  return sellerPrompt ? `${sellerPrompt}\n\n---\n\n${grounding}` : grounding;
}

// ─── n-payment provider cache (one per slug, lazy) ─────────────────────────

interface AgentRow {
  id: string;
  slug: string;
  brain_id: number;
  owner_address: string;
  persona: { system_prompt?: string | null; description?: string } | null;
  pricing: { x402?: string | null; fherc20?: string | null };
  daily_request_cap: number;
  published: boolean;
  /** Chain stamped at create time. Used to render the correct chain id in
   *  agent.json so AI buyers know which network's USDC to settle in. */
  chain: string | null;
}

interface CachedProvider {
  agent: AgentRow;
  middleware: express.RequestHandler;
  agentCardJson: object;
}

const providerCache = new Map<string, CachedProvider>();
const RESERVED_SLUGS = new Set(['api', 'admin', 'health', 'metrics', 'well-known', 'platform']);

function isReserved(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

async function loadAgent(slug: string): Promise<AgentRow | null> {
  if (isReserved(slug)) return null;
  const r = await pool.query(
    `SELECT id, slug, brain_id, owner_address, persona, pricing, daily_request_cap, published, chain
       FROM agents WHERE slug = $1 AND published = true AND archived_at IS NULL`,
    [slug],
  );
  return (r.rows[0] as AgentRow) ?? null;
}

/** Build the n-payment provider on demand. Called at most once per slug per process. */
async function buildProvider(agent: AgentRow): Promise<CachedProvider> {
  // n-payment 0.8.0 ships an ESM-only build: the `exports.require` entry
  // points to `./dist/index.cjs`, but that file is missing from the
  // published tarball — only `dist/index.js` (ESM) is shipped. A plain
  // `require('n-payment')` therefore fails with MODULE_NOT_FOUND, and
  // `await import('n-payment')` is silently rewritten by tsc (under
  // `module: commonjs`) into the same failing `require(...)` call.
  //
  // The fix below preserves a *native* dynamic import past tsc's rewriter
  // by hiding it inside a Function body. This is safe — and a deliberate
  // contrast to the previous `Function('m', 'return require(m)')` hack
  // that crashed at runtime: `require` is a CJS module-local binding so
  // it isn't visible inside a Function body (which executes in global
  // scope), but `import()` is engine-level JS syntax and resolves in any
  // scope. Same `: any` assertion sidesteps the viem 2.x → ox transitive
  // type graph that broke the build originally.
  const dynamicImport: (m: string) => Promise<any> = Function(
    'm',
    'return import(m)',
  ) as any;
  const np: any = await dynamicImport('n-payment');
  const { createAgentProvider, paidTool } = np;

  const priceUsdc = Number(agent.pricing?.x402 ?? '0');
  const priceMicroUsdc = Math.round(priceUsdc * 1_000_000);
  const facilitator =
    process.env.X402_FACILITATOR_URL ?? 'https://facilitator.x402.rs';
  // Chain priority: agent.chain (stamped at create time) → env override
  // → arbitrum-sepolia default. This way the same X402_NETWORK env can
  // serve as a global default while per-agent rows determine their own
  // settlement chain (Sui-published agents now report 'sui-testnet'
  // instead of incorrectly inheriting Arbitrum).
  const network = agent.chain ?? process.env.X402_NETWORK ?? 'arbitrum-sepolia';
  // Circle USDC on Arbitrum Sepolia (https://developers.circle.com/stablecoins/docs/usdc-on-test-networks)
  const asset =
    process.env.X402_USDC_ADDRESS ?? '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d';
  const publicApiUrl = process.env.PUBLIC_API_URL ?? 'http://localhost:3001';
  const endpointUrl = `${publicApiUrl}/api/v1/${agent.slug}`;

  const provider: any = createAgentProvider({
    name: agent.slug,
    description: `OpenX brain "${agent.slug}" — pay-per-call USDC on ${network}`,
    payTo: agent.owner_address,
    chain: network,
    asset,
    facilitator,
    tools: [
      paidTool({
        name: 'ask',
        description: 'Ask this brain a question.',
        price: priceMicroUsdc,
        handler: async (input: { question: string; uploadIds?: string[] }) =>
          runInference(agent, input.question, input.uploadIds ?? []),
      }),
    ],
  });

  // AgentCard JSON — built from the same config we passed to the provider.
  // This keeps the surface stable across n-payment minor versions.
  // `system_prompt` is exposed so AI buyers discover the seller's prompt
  // during the standard agent-card fetch (PRD-1 T3). Null when unset.
  const agentCardJson = {
    name: agent.slug,
    description: `OpenX brain "${agent.slug}" — pay-per-call USDC on ${network}`,
    url: endpointUrl,
    payTo: agent.owner_address,
    chain: network,
    asset,
    tools: [{ name: 'ask', price: priceMicroUsdc, currency: 'USDC' }],
    system_prompt: agent.persona?.system_prompt ?? null,
  };

  return { agent, middleware: provider.middleware(), agentCardJson };
}

/** Lookup-or-build with cached invalidation on owner update. */
async function getProvider(slug: string): Promise<CachedProvider | null> {
  if (providerCache.has(slug)) return providerCache.get(slug)!;
  const agent = await loadAgent(slug);
  if (!agent) return null;
  const built = await buildProvider(agent);
  providerCache.set(slug, built);
  return built;
}

/** Force-evict on agent edits (owner can call POST /v3/agents/:id and we should rebuild). */
export function invalidateProvider(slug: string): void {
  providerCache.delete(slug);
}

// ─── inference helper (kept small — delegates to existing services) ────────

/**
 * Inline budget for text-y attachments. Files smaller than this and with a
 * text-y MIME are fetched server-side via signed URL and pasted into the
 * prompt as labelled context. Anything larger is referenced by name + size
 * + signed URL so the LLM knows the document exists without us blowing
 * the context window.
 */
const UPLOAD_INLINE_BYTES = 100_000;
const TEXTY_MIME_RE = /^(text\/|application\/(json|csv|x-yaml|xml))/i;

interface UploadRow {
  id: string;
  storage_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
}

/**
 * Resolve `uploadIds[]` into an LLM-ready prompt prefix. Marks rows
 * consumed in the same transaction so a row can't be replayed across
 * many free /try calls.
 *
 * Pure-ish: queries DB + Supabase Storage; no other side-effects beyond
 * the consumed_at update. Returns the prompt prefix (possibly empty).
 */
export async function buildUploadContext(
  agentId: string,
  uploadIds: string[],
): Promise<string> {
  if (!uploadIds.length) return '';
  const { pool } = await import('../db');
  const r = await pool.query<UploadRow>(
    `UPDATE task_uploads
        SET consumed_at = NOW()
      WHERE id = ANY($1::uuid[])
        AND agent_id = $2
        AND consumed_at IS NULL
        AND expires_at > NOW()
      RETURNING id, storage_path, original_name, mime_type, size_bytes`,
    [uploadIds, agentId],
  );
  if (r.rowCount === 0) return '';

  const { getTaskUploadsStorage } = await import('../services/supabaseStorage');
  const storage = getTaskUploadsStorage();
  const blocks: string[] = [];
  for (const row of r.rows) {
    const uri = storage.toUri(row.storage_path);
    const inlineable =
      row.size_bytes <= UPLOAD_INLINE_BYTES && TEXTY_MIME_RE.test(row.mime_type);
    if (inlineable) {
      try {
        const buf = await storage.download(uri);
        blocks.push(
          `Reference document "${row.original_name}" (${row.mime_type}, ${row.size_bytes} bytes):\n---\n${buf.toString('utf8')}\n---`,
        );
        continue;
      } catch (err) {
        logger.warn({ id: row.id, err: (err as Error).message }, 'upload:inline:failed');
      }
    }
    // Binary or oversized: emit a signed-URL reference. The LLM can include
    // the URL in its answer if the agent persona supports tool calls.
    try {
      const signed = await storage.signedUrl(uri, 900);
      blocks.push(
        `Reference document "${row.original_name}" (${row.mime_type}, ${row.size_bytes} bytes, binary): ${signed}`,
      );
    } catch (err) {
      logger.warn({ id: row.id, err: (err as Error).message }, 'upload:signed:failed');
      blocks.push(
        `Reference document "${row.original_name}" (${row.mime_type}, ${row.size_bytes} bytes) — could not be loaded.`,
      );
    }
  }
  return blocks.join('\n\n');
}

/**
 * Run RAG + LLM for one paid call. Exported so PRD-2's `/v3/agents/:id/try`
 * can reuse the same path without duplicating the chunk-rank-LLM dance.
 *
 * `uploadIds` (PRD-E) attaches workspace files to the prompt. Empty array
 * is the legacy behaviour — every existing caller stays byte-identical.
 */
export async function runInference(
  agent: { id?: string; brain_id: number; persona: AgentRow['persona'] },
  question: string,
  uploadIds: string[] = [],
): Promise<{ answer: string; citations: number[] }> {
  const chunks = await KnowledgeIngestService.loadChunks(agent.brain_id);
  const ranked = rankChunks(question, chunks).slice(0, 5);
  const context = ranked.map((c) => c.content).filter(Boolean).join('\n---\n');
  const system = buildSystemPrompt(agent.persona, context);
  const uploadCtx =
    agent.id && uploadIds.length
      ? await buildUploadContext(agent.id, uploadIds)
      : '';
  const userMsg = uploadCtx ? `${uploadCtx}\n\n${question}` : question;
  const answer = await llmChat(system, [{ role: 'user', content: userMsg }]);
  // Citations are positional indices into the ranked chunk list; the agent.json
  // surface declares this so callers can map [n] → ranked[n].
  return { answer, citations: ranked.map((_, i) => i) };
}

// ─── routes ────────────────────────────────────────────────────────────────

/** Agent card discovery — public, free, cacheable. Must precede the paywall. */
router.get('/:slug/.well-known/agent.json', async (req: Request, res: Response) => {
  const provider = await getProvider(req.params.slug);
  if (!provider) return res.status(404).json({ error: 'agent not found' });
  res.set('Cache-Control', 'public, max-age=60');
  res.json(provider.agentCardJson);
});

/** Daily request cap — checked BEFORE the paywall (cheap 503 saves the buyer a tx). */
async function rateLimit(slug: string, cap: number): Promise<boolean> {
  const today = await ledger.countToday(slug);
  return today < cap;
}

/**
 * Dual-rail dispatch: route fherc20-tagged X-PAYMENT to our verifier; everything
 * else flows through n-payment's standard middleware (x402 / exact).
 */
router.use('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  const provider = await getProvider(req.params.slug);
  if (!provider) return res.status(404).json({ error: 'agent not found' });

  const allowed = await rateLimit(provider.agent.slug, provider.agent.daily_request_cap);
  if (!allowed) {
    return res.status(503).set('Retry-After', '3600').json({ error: 'daily_request_cap reached' });
  }

  // Freemium gate (T5/PRD-B): shared with paymentGate.ts. The buyer
  // identifies themselves via X-BUYER (not wallet auth — /api/v1 is public).
  if (process.env.FEATURE_FHE_PAY === 'true') {
    const buyer = (req.headers['x-buyer'] as string | undefined)?.toLowerCase();
    if (buyer) {
      const freeLeft = await ledger.checkFreePreview(buyer, provider.agent.id);
      if (freeLeft > 0) {
        await ledger.recordFree(buyer, provider.agent.id, provider.agent.slug);
        res.setHeader('X-Free-Preview-Remaining', String(freeLeft - 1));
        (req as any).receipt = { method: 'free', txHash: 'free-preview' };
        logger.info({ slug: provider.agent.slug, buyer, freeLeft: freeLeft - 1 }, 'v1Public:freemium-pass');
        return next();
      }
    }
  }

  // Buyer claims fherc20 path → verify on-chain log + advance.
  const xPay = (req.headers['x-payment'] as string | undefined) ?? '';
  if (xPay.startsWith('fherc20')) {
    const verified = await verifyFherc20Receipt({
      header: xPay,
      agent: provider.agent,
    });
    if (verified.ok !== true) {
      const reason = (verified as { ok: false; reason: string }).reason;
      return res.status(402).json({ error: reason });
    }
    // Advance to the route handler with verified receipt context.
    (req as any).receipt = { method: 'fherc20', txHash: verified.txHash };
    return next();
  }

  // Default: x402 / exact via n-payment middleware.
  return provider.middleware(req, res, next);
});

/** The single `ask` endpoint. Reaches here only after either rail verifies. */
router.get('/:slug', async (req: Request, res: Response) => {
  const provider = await getProvider(req.params.slug);
  if (!provider) return res.status(404).json({ error: 'agent not found' });

  const question = (req.query.q as string | undefined) ?? '';
  if (!question) return res.status(400).json({ error: 'q (question) required' });

  const result = await runInference(provider.agent, question);

  // fherc20 path needs explicit ledger write (n-payment handler runs only on x402).
  const receipt = (req as any).receipt as { method: string; txHash: string } | undefined;
  if (receipt?.method === 'fherc20') {
    await ledger.record({
      agentId: provider.agent.id,
      slug: provider.agent.slug,
      buyer: ((req.headers['x-buyer'] as string | undefined) ?? 'anonymous').toLowerCase(),
      amountUsdc: provider.agent.pricing?.fherc20 ?? '0.01',
      txHash: receipt.txHash,
      network: process.env.X402_NETWORK ?? 'arbitrum-sepolia',
      method: 'fherc20',
    }).catch((e) => logger.warn({ err: (e as Error).message }, 'ledger:record:fherc20:failed'));
  }
  res.json({ ...result, settled: receipt ?? { method: 'exact' } });
});

export default router;
