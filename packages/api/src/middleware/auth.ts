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
 */
export const auth = async (req: AuthRequest, res: Response, next: NextFunction) => {
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
