import { Request, Response, NextFunction } from 'express';
import type { PermitReason } from '../fhe/permits';

/**
 * PRD-F — single source of truth for the agent auth header. Renamed from
 * the legacy `x-fhenix-permit` per Q2=a (semantics unchanged; verification
 * still calls verifyPermit() which is now an EIP-712 recover under the hood).
 */
export const AUTH_HEADER = 'x-openx-token';

export interface AuthRequest extends Request {
  user?: {
    address: string;
    hasPermit: boolean;
    permitReason?: PermitReason;
    /** PRD-18 — single-use jti carried inside the onboard permit's `name`.
     *  Forwarded to sellerPublishService.publish() for atomic consumption. */
    permitJti?: string;
    /** PRD-18 — issuance ceiling (epoch seconds) recorded in
     *  onboard_permits_spent.expires_at. */
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
  // /v3/dashboard/stats — public cash-flow proof. Read-only aggregations
  // from public tables; safe to expose without wallet header.
  /^\/dashboard\/stats$/,
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

  // ─── Permit-auth path (preferred when header present) ──────────────────
  // The permit IS the proof of identity: verifyPermit() (without an
  // expectedIssuer) cryptographically derives the wallet address from the
  // signed blob. No need for x-wallet-address; spoofing is impossible.
  // Accept the new header (canonical), with a one-release grace window for
  // the legacy `x-fhenix-permit` so deployed agents don't break overnight.
  const permitHeader = req.headers[AUTH_HEADER] ?? req.headers['x-fhenix-permit'];
  const serialized = typeof permitHeader === 'string' ? permitHeader : null;
  if (serialized && serialized.length > 100) {
    try {
      const mod = await import('../fhe/permits');
      const result = await mod.verifyPermit(serialized);
      if (result.valid === false) {
        return res.status(401).json({ error: 'invalid permit', reason: result.reason });
      }
      const { issuer, jti, name, expiration } = result.permit;
      // Scope is enforced here: only `openx-onboard:*` permits may auth via
      // this header. Full-scope permits (legacy /v2/inference) keep using the
      // x-wallet-address path with a server-side hasPermit() lookup.
      if (!jti || !name?.startsWith(mod.ONBOARD_SCOPE_PREFIX)) {
        return res.status(401).json({ error: 'permit scope mismatch', reason: 'scope_mismatch' });
      }
      req.user = {
        address: issuer,
        hasPermit: true,
        permitReason: 'onchain_authorized',
        permitJti: jti,
        permitExpSec: expiration === Infinity ? undefined : expiration,
      };
      return next();
    } catch {
      return res.status(401).json({ error: 'permit verification failed' });
    }
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

  req.user = { address, hasPermit, permitReason };
  next();
};
