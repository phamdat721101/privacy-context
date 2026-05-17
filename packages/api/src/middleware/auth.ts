import { Request, Response, NextFunction } from 'express';
import { pool } from '../db';
import type { PermitReason } from '../fhe/permits';

export interface AuthRequest extends Request {
  user?: {
    address: string;
    subscribed: boolean;
    tier?: string;
    hasPermit: boolean;
    permitReason?: PermitReason;
  };
}

export const auth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const address = req.headers['x-wallet-address'] as string;
  if (!address) return res.status(401).json({ error: 'Missing wallet address' });

  const { rows } = await pool.query(
    `SELECT tier, expires_at FROM subscriptions WHERE user_address = $1 AND expires_at > NOW() LIMIT 1`,
    [address]
  );
  const sub = rows[0];

  // Lazy import keeps the API bootable even if the FHE module fails to load.
  let hasPermit = false;
  let permitReason: PermitReason | undefined;
  try {
    const mod = await import('../fhe/permits');
    const status = await mod.hasPermit(address);
    hasPermit = status.authorized;
    permitReason = status.reason;
  } catch {}

  req.user = { address, subscribed: !!sub, tier: sub?.tier, hasPermit, permitReason };
  next();
};
