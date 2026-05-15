import { createPaywall } from 'n-payment';
import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

const PAY_TO = process.env.PLATFORM_WALLET || '0x0000000000000000000000000000000000000000';

/**
 * x402 paywall for the /subscribe endpoint.
 * Uses n-payment's createPaywall to issue proper x402 challenges
 * and verify payment headers (payment-signature / x-payment-tx).
 */
export const x402Paywall = createPaywall({
  routes: {
    'POST /subscribe': {
      price: '5000000', // 5 USDC (6 decimals) — minimum tier
      description: 'Subscribe to FHE Second Brain',
      x402: {
        network: 'eip155:84532', // Base Sepolia
        payTo: PAY_TO,
      },
    },
  },
});

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
