import { Request, Response, NextFunction } from 'express';
import { pool } from '../db';

export interface AuthRequest extends Request {
  user?: { address: string; subscribed: boolean; tier?: string; hasPermit: boolean };
}

export const auth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const address = req.headers['x-wallet-address'] as string;
  if (!address) return res.status(401).json({ error: 'Missing wallet address' });

  const { rows } = await pool.query(
    `SELECT tier, expires_at FROM subscriptions WHERE user_address = $1 AND expires_at > NOW() LIMIT 1`,
    [address]
  );
  const sub = rows[0];

  // Check permit (lazy import to avoid crash if @cofhe/sdk not available)
  let hasPermit = false;
  try {
    const { hasPermit: checkPermit } = await import('../fhe/permits');
    hasPermit = await checkPermit(address);
  } catch {}

  req.user = { address, subscribed: !!sub, tier: sub?.tier, hasPermit };
  next();
};
