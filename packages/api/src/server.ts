import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { auth } from './middleware/auth';
import { agentKya } from './middleware/agent-kya';
import uploadRouter from './routes/upload';
import brainsRouter from './routes/brains';
import openapiRouter from './routes/openapi';
import v2Router from './routes/v2';
import v3Router from './routes/v3';
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
// /chat → 308 redirect to /v2/inference (legacy path; UI uses /v2/inference directly).
// /subscribe removed — sellers don't subscribe; buyers pay per-call x402 on /v2/inference.
app.all('/chat', (_req, res) => res.redirect(308, '/v2/inference'));

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

// T4: seeded demo agent — fires test queries against newly-published brains so
// sellers see their first earning event within seconds. No-op when
// DEMO_AGENT_ENABLED=false. Must run after listen so logs interleave nicely.
import('./services/demo-agent').then((m) => m.startDemoAgent()).catch((err) =>
  logger.warn({ err: err?.message }, 'demo-agent:boot:error'),
);
