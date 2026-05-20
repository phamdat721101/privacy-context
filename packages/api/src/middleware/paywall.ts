import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { logger } from '../lib';

const PAY_TO = process.env.PLATFORM_WALLET || '0x0000000000000000000000000000000000000000';

/**
 * x402 paywall for the /subscribe endpoint.
 */
let _paywall: any = null;
async function getPaywall() {
  if (!_paywall) {
    try {
      const { createPaywall } = await import('n-payment');
      _paywall = createPaywall({
        routes: {
          'POST /subscribe': {
            price: '5000000',
            description: 'Subscribe to FHE Second Brain',
            x402: { network: 'eip155:84532', payTo: PAY_TO },
          },
        },
      });
    } catch {
      _paywall = (_req: any, _res: any, next: any) => next();
    }
  }
  return _paywall;
}

export const x402Paywall = async (req: Request, res: Response, next: NextFunction) => {
  const pw = await getPaywall();
  if (typeof pw === 'function') return pw(req, res, next);
  next();
};

export const subscriptionGate = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.subscribed) {
    logger.debug({ path: req.path, address: req.user.address }, 'gate:subscription:pass');
    return next();
  }
  const challenge = Buffer.from(JSON.stringify({
    x402Version: 2,
    accepts: [{
      scheme: 'exact',
      network: 'eip155:84532',
      maxAmountRequired: '5000000',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      payTo: PAY_TO,
    }],
  })).toString('base64');

  res.setHeader('payment-required', challenge);
  res.status(402).json({
    error: 'Payment required',
    message: 'Active subscription needed. POST /subscribe with x402 payment.',
    protocols: ['x402'],
  });
};

/**
 * FHE permit gate — cache is perf-only; security enforced at insert time.
 */
export const permitGate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.hasPermit) {
    logger.debug({ path: req.path, address: req.user.address, reason: 'cache_hit' }, 'gate:permit:pass');
    return next();
  }

  // One bypass-cache attempt (self-heal for cache miss / cross-device revoke).
  let reason = req.user?.permitReason;
  try {
    const { hasPermit } = await import('../fhe/permits');
    const status = await hasPermit(req.user!.address, { forceRefresh: true });
    if (status.authorized) {
      req.user!.hasPermit = true;
      logger.debug({ path: req.path, address: req.user!.address, reason: status.reason }, 'gate:permit:pass');
      return next();
    }
    reason = status.reason;
  } catch { /* fall through */ }

  logger.info({ path: req.path, address: req.user?.address, reason }, 'gate:permit:reject');
  res.status(403).json({
    error: 'FHE authorization required',
    message: 'Authorize the platform on-chain (BrainKeyVault.authorize) then import your permit.',
    reason: reason ?? 'never_authorized',
  });
};

/**
 * Per-brain access gate — checks BrainKeyVault.isBrainGranted for non-owner callers.
 */
export const brainAccessGate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const brainId = req.body?.brainId || req.query?.brainId || req.params?.id;
  if (!brainId) return next(); // no brain context — skip

  const { pool } = await import('../db');
  const { rows } = await pool.query(`SELECT owner_address FROM brains WHERE id = $1`, [brainId]);
  if (!rows[0]) return next(); // brain not found — let downstream handle 404
  if (rows[0].owner_address === req.user!.address) return next(); // owner always passes

  // Non-owner: check per-brain grant
  const { isBrainGranted } = await import('../fhe/permits');
  const granted = await isBrainGranted(brainId);
  if (granted) return next();

  logger.info({ path: req.path, address: req.user?.address, brainId, reason: 'brain_not_granted' }, 'gate:brain:reject');
  res.status(403).json({ error: 'Brain access not granted', reason: 'brain_not_granted' });
};
