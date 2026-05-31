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
  // /v3/agents/slug-available — slug presence is public information.
  /^\/agents\/slug-available$/,
  // /v3/agents/:id/try — PRD-2 free, rate-limited demo invocation. The
  // rate limiter (in v3.ts) is the abuse defense here.
  /^\/agents\/[^/]+\/try$/,
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
