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

// ─── n-payment provider cache (one per slug, lazy) ─────────────────────────

interface AgentRow {
  id: string;
  slug: string;
  brain_id: number;
  owner_address: string;
  pricing: { x402?: string | null; fherc20?: string | null };
  daily_request_cap: number;
  published: boolean;
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
    `SELECT id, slug, brain_id, owner_address, pricing, daily_request_cap, published
       FROM agents WHERE slug = $1 AND published = true`,
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
  const network = process.env.X402_NETWORK ?? 'arbitrum-sepolia';
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
        handler: async (input: { question: string }) => runInference(agent.brain_id, input.question),
      }),
    ],
  });

  // AgentCard JSON — built from the same config we passed to the provider.
  // This keeps the surface stable across n-payment minor versions.
  const agentCardJson = {
    name: agent.slug,
    description: `OpenX brain "${agent.slug}" — pay-per-call USDC on ${network}`,
    url: endpointUrl,
    payTo: agent.owner_address,
    chain: network,
    asset,
    tools: [{ name: 'ask', price: priceMicroUsdc, currency: 'USDC' }],
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

async function runInference(brainId: number, question: string): Promise<{ answer: string; citations: number[] }> {
  const chunks = await KnowledgeIngestService.loadChunks(brainId);
  const ranked = rankChunks(question, chunks).slice(0, 5);
  const context = ranked.map((c) => c.content).filter(Boolean).join('\n---\n');
  const system = context
    ? `Answer using ONLY this knowledge:\n${context}`
    : `No knowledge available; respond honestly that the brain is empty.`;
  const answer = await llmChat(system, [{ role: 'user', content: question }]);
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

  const result = await runInference(provider.agent.brain_id, question);

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
