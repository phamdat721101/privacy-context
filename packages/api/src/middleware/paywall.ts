import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

const PAY_TO = process.env.PLATFORM_WALLET || '0x0000000000000000000000000000000000000000';

/**
 * x402 paywall for the /subscribe endpoint.
 * Uses n-payment's createPaywall to issue proper x402 challenges
 * and verify payment headers (payment-signature / x-payment-tx).
 * Import is lazy to avoid crash when n-payment CJS build is unavailable.
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
      // n-payment unavailable — pass through
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
/**
 * Subscription-based access gate for /chat and /upload.
 * Subscribers (verified via DB cache) pass through.
 * Non-subscribers get 402 directing them to /subscribe.
 */
export const subscriptionGate = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.subscribed) return next();

  // Return 402 with x402 challenge pointing to /subscribe
  const challenge = Buffer.from(JSON.stringify({
    x402Version: 2,
    accepts: [{
      scheme: 'exact',
      network: 'eip155:84532',
      maxAmountRequired: '5000000',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // USDC on Base Sepolia
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
 * FHE permit gate — requires user to have authorized the platform on-chain.
 * Self-heals on cache miss: if `auth` saw no permit, do one bypass-cache
 * on-chain check before returning 403. The 403 body carries a `reason`
 * field the frontend uses to guide the user into the right recovery.
 */
export const permitGate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.hasPermit) return next();

  // One bypass-cache attempt before failing.
  let reason = req.user?.permitReason;
  try {
    const { hasPermit } = await import('../fhe/permits');
    const status = await hasPermit(req.user!.address, { forceRefresh: true });
    if (status.authorized) {
      req.user!.hasPermit = true;
      req.user!.permitReason = status.reason;
      return next();
    }
    reason = status.reason;
  } catch { /* fall through with whatever reason auth saw */ }

  res.status(403).json({
    error: 'FHE authorization required',
    message: 'Authorize the platform on-chain (BrainKeyVault.authorize) before this action.',
    reason: reason ?? 'never_authorized',
  });
};
