import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { auth } from './middleware/auth';
import { agentKya } from './middleware/agent-kya';
import uploadRouter from './routes/upload';
import brainsRouter from './routes/brains';
import chatRouter from './routes/chat';
import openapiRouter from './routes/openapi';
import v2Router from './routes/v2';
import v3Router from './routes/v3';
import v3IdentityRouter from './routes/v3-identity';
import v3WorkflowsRouter from './routes/v3-workflows';
import v3SkillsRouter from './routes/v3-skills';
import v3ReflectiveRouter from './routes/v3-reflective';
import v3MemoryRouter from './routes/v3-memory';
import v3MarketplaceRouter from "./routes/v3-marketplace";
import v4Router from './routes/v4';
import v1PublicRouter from './routes/v1Public';
import mcpRouter from './routes/mcp';
import v3TatumRouter from './routes/v3-tatum';
import {
  logger,
  correlationId,
  metricsMiddleware,
  metricsHandler,
  healthHandler,
  installLifecycle,
} from './lib';

const app = express();
app.use(cors());
app.use(correlationId());
app.use(metricsMiddleware());
app.use(express.json());

// Public endpoints
app.get('/health', healthHandler);
app.get('/metrics', metricsHandler);

// v2 API — opaque-only, no plaintext keys. Auth + agent identity only.
// Per docs/USP_BRIEF.md: sellers don't subscribe (publish-and-earn);
// buyers pay per-query via x402 outside this gate. Each v2 route
// owns any further gating (e.g. ownership checks).
app.use('/v2', auth, agentKya, v2Router);

// v3 API — dual-chain agentic marketplace. Additive; v2 untouched.
// Per-route ownership/KYA gating happens inside the sub-router.
app.use('/v3', auth, agentKya, v3Router);

// v3 EVM↔Sui identity binding — separate sub-router so the auth boundary
// is unambiguous (uses /v3/identity/* prefix, agentKya skipped because the
// binding is for human users, not agents).
app.use('/v3/identity', auth, v3IdentityRouter);

// v3 Workflows — Sui-native L4 product surface. requireSuiWallet is applied
// per-route inside v3WorkflowsRouter (G2 isolation on POST publish + execute).
// GET endpoints stay open so Standard-tier visitors can browse the catalog.
app.use('/v3/workflows', auth, agentKya, v3WorkflowsRouter);

// v3 Skills — Sui-native standalone Skill product type. Same auth pattern
// as workflows: GETs open for catalog, POSTs gated by requireSuiWallet inside.
app.use('/v3/skills', auth, agentKya, v3SkillsRouter);

// v3 Reflective traces — L5 license-tier product. Same pattern as skills.
app.use('/v3/reflective', auth, agentKya, v3ReflectiveRouter);

// v3 Memory — paid recall/remember/restore against Walrus Memory (PRD-06).
// Every route inside applies `requireSuiWallet` (G2). Skipped silently when
// MEMWAL_PEERDEP_ENABLED=false: the adapter throws OpenXMemWalUpstreamMissingError
// which the route translates to a 503 with an actionable hint.
app.use('/v3/memory', auth, agentKya, v3MemoryRouter);

// /v3/marketplace — seller-first marketplace v1 (PRD-A/B/C).
// /listings is whitelisted in auth.ts (anonymous browsers + the
// /seller/onboard success card hit it before any wallet connects);
// /seller/publish requires `x-wallet-address`.
app.use("/v3/marketplace", auth, agentKya, v3MarketplaceRouter);

// v4 API — private-payment surface (T5/PRD-B). Flag-gated for byte-identical
// rollback. Off → 404; on → /v4/billing/* + /v4/settlement/* + /v4/admin/stats.
if (process.env.FEATURE_FHE_PAY === 'true') {
  app.use('/v4', auth, v4Router);
  logger.info({ flag: 'FEATURE_FHE_PAY' }, 'v4:mounted');
}

// /api/v1 — PUBLIC, x402-paywalled brain endpoints. NO parent auth — the
// paywall (n-payment middleware) is the auth. Per PRD-1.
app.use('/api/v1', v1PublicRouter);

// /mcp — MCP JSON-RPC 2.0 server (protocol 2025-11-25). Public; the -32402
// envelope on paid tools is the paywall. See packages/sdk/src/mcp/server.ts.
app.use('/mcp', mcpRouter);

// /v3/webhooks — Tatum Notifications receiver. Public (signature-verified).
// Side-channel from /v3 to keep auth wiring clean.
app.use('/v3/webhooks', v3TatumRouter);

app.get('/platform', (_, res) => res.json({
  platformWallet: process.env.PLATFORM_WALLET || '',
  contracts: {
    subscriptionController: process.env.SUBSCRIPTION_CONTROLLER_ADDRESS,
    knowledgeRegistry: process.env.KNOWLEDGE_REGISTRY_ADDRESS,
    brainKeyVault: process.env.BRAIN_KEY_VAULT_ADDRESS,
  },
}));
app.use('/openapi.json', openapiRouter);
app.use('/brains', brainsRouter);

// Permit routes (Fhenix authorization — on-chain verified)
app.post('/permit/import', async (req, res) => {
  const { userAddress, serializedPermit, txHash } = req.body;
  if (!userAddress) return res.status(400).json({ error: 'userAddress required' });

  const { importPermit, confirmOnChain } = await import('./fhe/permits');

  // Primary path: SDK permit blob (full verification)
  if (serializedPermit && typeof serializedPermit === 'string' && serializedPermit.length > 100) {
    const result = await importPermit(userAddress, serializedPermit);
    if ('reason' in result) return res.status(400).json({ error: 'Permit verification failed', reason: result.reason });
    return res.json({ ok: true, expiresAt: result.expiresAt });
  }

  // Fallback path: tx hash — verify on-chain state directly
  if (txHash || serializedPermit) {
    const onchain = await confirmOnChain(userAddress);
    if (!onchain.authorized) {
      return res.status(400).json({ error: 'On-chain authorization not found', reason: 'onchain_unauthorized' });
    }
    // Cache the on-chain confirmation
    const { pool } = await import('./db');
    const addr = userAddress.toLowerCase();
    await pool.query(
      `INSERT INTO permits (user_address, serialized_permit, permit_kind)
       VALUES ($1, $2, 'onchain')
       ON CONFLICT (user_address) DO UPDATE SET serialized_permit = $2, permit_kind = 'onchain', created_at = NOW()`,
      [addr, (txHash || serializedPermit || '').slice(0, 200)],
    );
    return res.json({ ok: true, method: 'onchain_verified' });
  }

  res.status(400).json({ error: 'serializedPermit or txHash required' });
});
app.delete('/permit/revoke', async (req, res) => {
  const { userAddress } = req.body;
  if (!userAddress) return res.status(400).json({ error: 'userAddress required' });
  try {
    const { revokePermit } = await import('./fhe/permits');
    await revokePermit(userAddress);
    res.json({ ok: true });
  } catch (e: any) {
    res.json({ ok: true });
  }
});

// x402 paywall on subscribe (disabled in dev, enable in production)
// /chat — chat router (handles store + learn modes; Sui-aware). The EVM
// permit gate is enforced inside the route handler. Previously a 308
// redirect to /v2/inference; that masked Sui flows because the redirected
// endpoint assumes Fhenix-encrypted chunks. Now mounted properly so the
// chain dispatch lives in one file (`routes/chat.ts`).
app.use('/chat', auth, chatRouter);

// Upload — wallet-auth only. The permit (FHE on-chain authorization) is a
// feature gate for the encrypted-brain path, not a precondition for plaintext
// ingestion. Ownership is enforced via `req.user.address` downstream in
// KnowledgeIngestService and the brain-id lookup.
app.use('/upload', auth, uploadRouter);

// Lightweight server-authoritative permit status (used by frontend to
// reconcile cached state with on-chain truth). Returns {authorized, reason}
// so the UI can surface diagnostic guidance instead of a generic dead-end.
app.get('/permit/status', async (req, res) => {
  const address = (req.query.address as string | undefined)?.toLowerCase();
  if (!address) return res.status(400).json({ error: 'address required' });
  try {
    const { hasPermit } = await import('./fhe/permits');
    const forceRefresh = req.query.refresh === '1';
    const status = await hasPermit(address, { forceRefresh });
    res.json(status);
  } catch {
    res.json({ authorized: false, reason: 'rpc_error' });
  }
});

const PORT = Number(process.env.PORT ?? 3001);

// Boot-time env validation (fail fast)
const REQUIRED_VARS = ['DATABASE_URL', 'PLATFORM_WALLET', 'BRAIN_KEY_VAULT_ADDRESS', 'ARBITRUM_SEPOLIA_RPC'];
const missing = REQUIRED_VARS.filter(v => !process.env[v]);
if (missing.length) {
  logger.error({ missing }, 'Missing required env vars — exiting');
  process.exit(1);
}

const server = app.listen(PORT, () => logger.info({ port: PORT }, 'api:listening'));
installLifecycle(server);

// MemWal settlement worker (PRD-11 / T15) — every 60s, batch un-settled paid
// queries per brain, apply the volume dial, emit on-chain SettlementBatchEmitted,
// record memwal_revenue_settlements rows. No-op when MEMWAL_SETTLEMENT_ENABLED=false.
import('./services/memwalSettlement').then((m) => {
  const enabled = process.env.MEMWAL_SETTLEMENT_ENABLED !== 'false';
  // Deferred to avoid a top-level pool import here — services/* own their own
  // db handles via ../db. Pass the same pool the routes use.
  return import('./db').then((db) => {
    const w = new m.MemWalSettlementWorker({ pool: db.pool, enabled });
    w.start();
    server.on('close', () => w.stop());
  });
}).catch((err) =>
  logger.warn({ err: (err as Error).message }, 'memwal:settlement:boot:error'),
);

// T4: seeded demo agent — fires test queries against newly-published brains so
// sellers see their first earning event within seconds. No-op when
// DEMO_AGENT_ENABLED=false. Must run after listen so logs interleave nicely.
import('./services/demo-agent').then((m) => m.startDemoAgent()).catch((err) =>
  logger.warn({ err: err?.message }, 'demo-agent:boot:error'),
);

// Walrus epoch renewal — Phase 4 productization. Off by default; enable
// per-deployment via WALRUS_RENEWAL_ENABLED=true once at least 1 brain has
// been published to Walrus (otherwise the cron is a Postgres no-op).
if (process.env.WALRUS_RENEWAL_ENABLED === 'true') {
  import('./services/walrusRenewal')
    .then((m) => m.startWalrusRenewalCron())
    .catch((err) => logger.warn({ err: err?.message }, 'walrus-renewal:boot:error'));
}
