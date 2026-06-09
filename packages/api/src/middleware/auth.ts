import { Request, Response, NextFunction } from 'express';
import type { PermitReason } from '../fhe/permits';

export interface AuthRequest extends Request {
  user?: {
    address: string;
    hasPermit: boolean;
    permitReason?: PermitReason;
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
  // /v3/agents/search — keyword fast-path search (PRD-17). Public; reads
  // MemWal openx-agent-index, falls back to Postgres TF-IDF.
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
  // /v3/marketplace/workflows — public workflow listing catalog (PRD-15).
  /^(?:\/marketplace)?\/workflows$/,
  // /v3/marketplace/workflows/:slug — public workflow detail page.
  /^(?:\/marketplace)?\/workflows\/[^/]+$/,
  // /v3/marketplace/workflows/:slug/recent — anonymized last-N runs.
  /^(?:\/marketplace)?\/workflows\/[^/]+\/recent$/,
  // /v3/agents/:id/try — PRD-2 free, rate-limited demo invocation. The
  // rate limiter (in v3.ts) is the abuse defense here.
  /^\/agents\/[^/]+\/try$/,
  // /v3/discover — concierge marketplace search; the route uses neither
  // req.user nor wallet-scoped data and is invoked from /marketplace
  // before any wallet has connected.
  /^\/discover$/,
  // /v3/brains/:id/sovereignty-proof — institutional-grade audit endpoint
  // (Walrus + Sui only). Per route comment, must remain answerable even if
  // Postgres is down; gating it on a wallet defeats the trust model since
  // anyone can verify a published brain without going through OpenX.
  /^\/brains\/[^/]+\/sovereignty-proof$/,
  // /v3/brains/:id/cost — public Walrus pricing telemetry; same trustless
  // surface as sovereignty-proof, no wallet context required.
  /^\/brains\/[^/]+\/cost$/,
  // /v3/workflows/:id/sovereignty-proof — same audit-grade primitive as
  // brains: rebuilds from Walrus + Sui alone with OpenX DB disabled.
  // NB: this router is mounted at /v3/workflows, so auth sees the path
  // RELATIVE to the mount point (no /workflows prefix).
  /^\/[^/]+\/sovereignty-proof$/,
  // /v3/dashboard/stats — public cash-flow proof (Frame F1). Read-only
  // aggregations from public tables; safe to expose without wallet header.
  /^\/dashboard\/stats$/,
  // /v3/memory/marketplace — public catalog of MemWal-tier brains. Browsable
  // before any wallet connects; the brain detail + sovereignty endpoints
  // below match the same trustless-by-design surface.
  //
  // Note: the optional `/memory` prefix is intentional. Express runs the
  // `/v3` mount's auth BEFORE the `/v3/memory` mount, so `req.path` here is
  // `/memory/marketplace` for the first auth pass and `/marketplace` for
  // the second. One regex, both passes.
  /^(?:\/memory)?\/marketplace$/,
  // /v3/memory/brain/:id — public brain detail (no decryption).
  /^(?:\/memory)?\/brain\/[^/]+\/?$/,
  // /v3/memory/brain/:id/sovereignty-proof — must answer even with Postgres
  // down. Edge-cached 1h via Caddy in production.
  /^(?:\/memory)?\/brain\/[^/]+\/sovereignty-proof$/,
];

export const auth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (PUBLIC_PATHS.some((re) => re.test(req.path))) return next();

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
