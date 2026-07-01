import { Request, Response, NextFunction } from 'express';
import type { PermitReason } from '../fhe/permits';
import {
  decodeEnvelope,
  verifyOnboardToken,
  type OnboardChain,
} from '../services/onboardTokenService';
import { getXamanClient } from '../services/xamanClient';

/**
 * PRD-H — chain-agnostic auth. Single header, single verify path.
 */
export const AUTH_HEADER = 'x-openx-token';

export interface AuthRequest extends Request {
  user?: {
    address: string;
    /** Which chain the envelope was signed on. Downstream code branches on this. */
    chain: OnboardChain;
    hasPermit: boolean;
    permitReason?: PermitReason;
    /** Single-use jti carried inside the envelope's nonce field. */
    permitJti?: string;
    /** Issuance ceiling (epoch seconds) recorded in onboard_permits_spent. */
    permitExpSec?: number;
  };
}

/**
 * Auth middleware — wallet-address based.
 *
 * Per docs/USP_BRIEF.md: sellers don't subscribe. Buyers pay per-call x402 on
 * /v2/inference (enforced inside the route, not here). This middleware only
 * proves wallet identity + caches the FHE permit status.
 *
 * Public-by-design routes mounted under an authed router declare themselves
 * here. Adding a route to PUBLIC_PATHS is the canonical way to opt out — keeps
 * the public surface visible at one place rather than scattered across the
 * routers it lives inside.
 */
const PUBLIC_PATHS: RegExp[] = [
  // /v3/version — diagnostic ping; route comment marks it as public.
  /^\/version$/,
  // /v3/agents/slug-available — slug presence is public information.
  /^\/agents\/slug-available$/,
  // /v3/agents/top — public top-N ranked agents (home highlights).
  // Read-only aggregation over `paid_calls`; called before any wallet has
  // connected, so it cannot require an x-wallet-address header.
  /^\/agents\/top$/,
  // /v3/agents — public listing of all published, non-archived agents.
  // The route SQL filters `WHERE published = true AND archived_at IS NULL`,
  // so no private data leaks. Required to be public so /agent/[id]'s
  // getAgent() merge populates slug + v3AgentId without forcing a sign-in
  // (drives isPublished detection → HireBox visibility).
  /^\/agents$/,
  // /v3/agents/search — keyword fast-path search. Public; reads the
  // cached Postgres TF-IDF corpus.
  /^\/agents\/search$/,
  // /v3/marketplace/listings — public catalog read; called from
  // /marketplace and the /seller/onboard success card before any wallet
  // has connected. Single indexed SELECT, no wallet context needed.
  //
  // The /marketplace prefix is optional here because Express runs the
  // /v3 mount's auth pass BEFORE the /v3/marketplace mount's auth pass:
  // first pass sees req.path = /marketplace/listings, second pass sees
  // /listings. One regex covers both, same shape as the /memory rules
  // a few lines below.
  /^(?:\/marketplace)?\/listings$/,
  // /v3/marketplace/seller/agent/:id/onchain-status (PRD-19) — read-only
  // status of the gasless on-chain registration. The frontend dashboard
  // polls this every 5s; both the tx hash and the brain id are already
  // public on Arbitrum Sepolia, so no auth context is required.
  /^(?:\/marketplace)?\/seller\/agent\/[^/]+\/onchain-status$/,
  // /v3/marketplace/workflows — public workflow listing catalog (PRD-15).
  /^(?:\/marketplace)?\/workflows$/,
  // /v3/marketplace/workflows/:slug — public workflow detail page.
  /^(?:\/marketplace)?\/workflows\/[^/]+$/,
  // /v3/marketplace/workflows/:slug/recent — anonymized last-N runs.
  /^(?:\/marketplace)?\/workflows\/[^/]+\/recent$/,
  // /v3/agents/:id/try — PRD-2 free, rate-limited demo invocation. The
  // rate limiter (in v3.ts) is the abuse defense here.
  /^\/agents\/[^/]+\/try$/,
  // /v3/agents/:id/uploads — PRD-E signed-URL mint. Anonymous demo
  // users need this for the free tier's file attach. The route's
  // 50MB size cap + 100/hour/agent rate cap are the abuse defense
  // (same posture as /try).
  /^\/agents\/[^/]+\/uploads$/,
  // /v3/agents/:id/recent-calls — PRD-E public TX history feed.
  // Server already anonymizes payer addresses; counts come from
  // paid_calls which is read-only public ledger material.
  /^\/agents\/[^/]+\/recent-calls$/,
  // /v4/cognitive/brain/:brainId/snapshot — public cognitive counts
  // (episodes / facts / skills / topics / 14-day activity). Mounted
  // under /v4 with auth, but the route emits no plaintext bodies, so
  // anonymous reads are safe and required (the agent detail page
  // fetches this before any wallet has connected).
  /^\/cognitive\/brain\/[^/]+\/snapshot$/,
  // /v3/discover — concierge marketplace search; the route uses neither
  // req.user nor wallet-scoped data and is invoked from /marketplace
  // before any wallet has connected.
  /^\/discover$/,
  // /v3/credits/config (PRD-G) — public, read-only addresses + pack list
  // needed by the browser top-up modal to build a USDC.transfer call.
  // No sensitive data; same posture as /platform.
  /^\/credits\/config$/,
  // /v3/dashboard/stats — public cash-flow proof. Read-only aggregations
  // from public tables; safe to expose without wallet header.
  /^\/dashboard\/stats$/,
  // /v3/concierge/onboard (PRD-1) — natural-language fast-path for
  // self-hosted public agents. Permissionless; protected by an in-process
  // per-IP rate limiter + optional Cloudflare Turnstile gate.
  /^\/concierge\/onboard$/,
  // /v3/agents/:agent_id/tasks/:external_task_id/deliver — seller-async
  // callback. Authenticated by HMAC bearer token issued by OpenX when the
  // task was parked. The seller's box has no Privy session, so we whitelist
  // here and verify in the handler.
  /^\/agents\/[^/]+\/tasks\/[^/]+\/deliver$/,
  // PRD-H — onboard-token issuance surfaces.
  /^\/onboard\/nonce$/,
  /^\/onboard\/xaman\/create$/,
  /^\/onboard\/xaman\/[^/]+$/,
];

/**
 * PRD-18 — routes that REQUIRE x-fhenix-permit when FEATURE_PERMIT_AUTH=true.
 *
 * Mirror of PUBLIC_PATHS for the inverse direction. Mounted under
 * /v3/marketplace, so the middleware sees relative paths (with or without
 * the /marketplace prefix depending on which mount runs first — same shape
 * as the listing/workflow whitelist regexes above).
 *
 * When FEATURE_PERMIT_AUTH=false (default), this list has no effect:
 * x-wallet-address keeps working byte-identically and rollback is free.
 */
const PERMIT_AUTH_REQUIRED: RegExp[] = [
  /^(?:\/marketplace)?\/seller\/publish$/,
];

export const auth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (PUBLIC_PATHS.some((re) => re.test(req.path))) return next();

  // PRD-H — hard-reject legacy `x-fhenix-permit`. Old clients get a clear
  // migration hint instead of a silent "invalid" bounce.
  if (req.headers['x-fhenix-permit']) {
    return res.status(401).json({
      error: 'legacy_token_rejected',
      reason: 'Use x-openx-token (SIWE / XRPL envelope). See /docs.',
    });
  }

  // ─── Onboard-token path (canonical) ────────────────────────────────────
  const headerVal = req.headers[AUTH_HEADER];
  const raw = typeof headerVal === 'string' ? headerVal : Array.isArray(headerVal) ? headerVal[0] : null;
  const envelope = raw ? decodeEnvelope(raw) : null;
  if (envelope) {
    const xamanClient = getXamanClient();
    const result = await verifyOnboardToken(envelope, {
      expectedDomain: process.env.SIWE_DOMAIN,
      xaman: xamanClient?.verifier,
    });
    if (!result.ok) {
      const reason = 'reason' in result ? result.reason : 'signature_invalid';
      return res.status(401).json({ error: 'invalid_token', reason });
    }
    req.user = {
      address: result.token.address,
      chain: result.token.chain,
      hasPermit: true,
      permitReason: 'onchain_authorized',
      permitJti: result.token.jti,
      permitExpSec: result.token.expiresAtSec,
    };
    await ensureCreditAccountIfEnabled(req, result.token.address);
    return next();
  }

  // ─── Permit-auth gate (PRD-18 §6) ──────────────────────────────────────
  // When the feature flag is on, the routes in PERMIT_AUTH_REQUIRED MUST
  // carry an onboard permit; the legacy x-wallet-address path is rejected.
  if (
    process.env.FEATURE_PERMIT_AUTH === 'true' &&
    PERMIT_AUTH_REQUIRED.some((re) => re.test(req.path))
  ) {
    return res.status(401).json({ error: `${AUTH_HEADER} required`, reason: 'permit_required' });
  }

  // ─── Legacy x-wallet-address path (byte-identical default) ─────────────
  const address = req.headers['x-wallet-address'] as string;
  if (!address) return res.status(401).json({ error: 'Missing wallet address' });

  let hasPermit = false;
  let permitReason: PermitReason | undefined;
  try {
    const mod = await import('../fhe/permits');
    const status = await mod.hasPermit(address);
    hasPermit = status.authorized;
    permitReason = status.reason;
  } catch {
    /* permit module load failure is non-fatal here */
  }

  req.user = { address, chain: 'evm', hasPermit, permitReason };
  await ensureCreditAccountIfEnabled(req, address);
  next();
};

/**
 * PRD-G — lazy welcome-bonus grant.
 *
 * Fires on every authenticated request when FEATURE_CREDIT_SYSTEM=true.
 * `creditService.ensureAccount` is idempotent: it only writes when the
 * account row is missing OR when we see a new Privy user id we can link.
 * The welcome bonus is granted exactly once per Privy user (or once per
 * wallet when `WELCOME_GRANT_WALLET_ONLY=true`).
 *
 * Errors are logged + swallowed so a credit-service hiccup never blocks an
 * authed read. The credit system is additive; flipping the flag off
 * reverts to byte-identical behaviour.
 */
async function ensureCreditAccountIfEnabled(req: AuthRequest, walletAddress: string): Promise<void> {
  if (process.env.FEATURE_CREDIT_SYSTEM !== 'true') return;
  try {
    const [credits, libMod] = await Promise.all([
      import('../services/creditService'),
      import('../lib'),
    ]);
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const privy_user_id = bearer ? await libMod.verifyPrivyToken(bearer) : null;
    await credits.ensureAccount({ wallet_address: walletAddress, privy_user_id });
  } catch (err) {
    // Single-line warn; no stack — this is non-fatal scaffolding.
    // We deliberately do not import the logger at module top because the
    // permit module load above already shows lazy-import is the project norm.
    try {
      const { logger } = await import('../lib');
      logger.warn({ err: (err as Error).message }, 'auth:ensureCreditAccount:failed');
    } catch {/* noop */}
  }
}
