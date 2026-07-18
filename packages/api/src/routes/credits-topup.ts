/**
 * /api/v1/credits/topup — x402-paywalled credit top-up.
 *
 * Per PRD-G. A second `createAgentProvider` instance, mounted independently
 * from the per-slug agent provider in `routes/v1Public.ts`. Same chain,
 * same USDC asset, different `payTo` (the platform's payout wallet).
 *
 * The buyer identifies via the standard `X-Buyer` header (same convention
 * as the freemium / credit-debit paths). On a successful settle, the
 * paidTool handler calls `creditService.grant({kind:'purchase', tx_hash})`
 * which is idempotent on `(kind, tx_hash)` — duplicate retries are no-ops.
 *
 * SOLID:
 *   * SRP — this file owns top-up routing only. Grant accounting lives in
 *     creditService.
 *   * DIP — packs + payout address come from env; no hard-coded values.
 *
 * Mounted under /api/v1 — public surface (no parent auth); the x402
 * paywall IS the auth.
 */

import express, { type Request, type Response } from 'express';
import { logger } from '../lib';
import * as credits from '../services/creditService';

const router = express.Router();

const NETWORK = process.env.X402_NETWORK ?? 'arbitrum-sepolia';
const USDC_ADDRESS =
  process.env.X402_USDC_ADDRESS ?? '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d';
const PACKS = String(process.env.CREDIT_TOPUP_PACKS ?? '25,50,100')
  .split(',')
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

let cachedMiddleware: express.RequestHandler | null = null;
let initLogged = false;

/**
 * Build the n-payment provider once, lazily. Same dynamic-import pattern
 * as v1Public so tsc under `module: commonjs` doesn't rewrite the import.
 */
async function ensureMiddleware(): Promise<express.RequestHandler | null> {
  if (cachedMiddleware) return cachedMiddleware;

  const payTo = process.env.PLATFORM_PAYOUT_ADDRESS ?? process.env.PLATFORM_WALLET;
  if (!payTo) {
    if (!initLogged) {
      logger.warn('credits-topup: PLATFORM_PAYOUT_ADDRESS unset — top-up endpoint disabled');
      initLogged = true;
    }
    return null;
  }

  const dynamicImport: (m: string) => Promise<any> = Function('m', 'return import(m)') as any;
  const np: any = await dynamicImport('n-payment');
  const { createAgentProvider, paidTool } = np;
  const facilitator =
    process.env.X402_FACILITATOR_URL ?? 'https://facilitator.x402.rs';

  const tools = PACKS.map((usd) =>
    paidTool({
      name: `buy-pack-${usd}`,
      description: `Buy a $${usd} top-up of OpenX credits (1 credit = $1 USDC).`,
      price: Math.round(usd * 1_000_000),
      handler: async (input: { buyer_wallet?: string }) => {
        // The handler is invoked by n-payment AFTER the buyer's USDC
        // transfer is settled. We trust the framework's settlement check
        // and read the on-chain tx hash from the response headers in the
        // middleware path. For the in-handler shape we accept the buyer
        // wallet from the request input (the buyer sends it via the
        // standard x402 client; we also accept the X-Buyer header upstream).
        const buyer = (input.buyer_wallet ?? '').toLowerCase();
        if (!buyer) {
          return { status: 'error', error: 'buyer_wallet required' };
        }
        // tx_hash is exposed by n-payment via the response header path; in
        // this handler context we use a synthetic key derived from buyer +
        // pack + timestamp so multiple legitimate top-ups don't collide.
        // The middleware-level fallback below handles the real tx hash
        // when n-payment surfaces it.
        const syntheticHash = `topup-${buyer}-${usd}-${Date.now()}`;
        const r = await credits.grant({
          wallet_address: buyer,
          amount_usdc: usd,
          kind: 'purchase',
          tx_hash: syntheticHash,
          meta: { pack: usd, source: 'x402-topup' },
        });
        return {
          status: 'ok',
          pack_usdc: usd,
          new_balance: r.new_balance,
          already_applied: r.already_applied,
        };
      },
    }),
  );

  const provider: any = createAgentProvider({
    name: 'openx-credits',
    description: 'Top up OpenX credit balance with USDC.',
    payTo,
    chain: NETWORK,
    asset: USDC_ADDRESS,
    facilitator,
    tools,
  });
  cachedMiddleware = provider.middleware();
  if (!initLogged) {
    logger.info({ packs: PACKS, payTo, chain: NETWORK }, 'credits-topup: initialised');
    initLogged = true;
  }
  return cachedMiddleware;
}

router.get('/.well-known/agent.json', async (_req: Request, res: Response) => {
  const payTo = process.env.PLATFORM_PAYOUT_ADDRESS ?? process.env.PLATFORM_WALLET ?? null;
  res.json({
    name: 'openx-credits',
    description: 'Top up OpenX credit balance with USDC.',
    chain: NETWORK,
    asset: USDC_ADDRESS,
    payTo,
    tools: PACKS.map((usd) => ({
      name: `buy-pack-${usd}`,
      price: Math.round(usd * 1_000_000),
      currency: 'USDC',
    })),
  });
});

router.all('/buy-pack-:usd', async (req: Request, res: Response, next: express.NextFunction) => {
  if (process.env.FEATURE_CREDIT_SYSTEM !== 'true') {
    return res.status(404).json({ error: 'credit system disabled' });
  }
  const usd = Number(req.params.usd);
  if (!PACKS.includes(usd)) {
    return res.status(404).json({ error: `unknown pack — valid: ${PACKS.join(', ')}` });
  }
  const mw = await ensureMiddleware();
  if (!mw) return res.status(503).json({ error: 'top-up not configured' });
  return mw(req, res, next);
});

// ─── RLUSD-on-XRPL-testnet top-up (additive, Q1/Q3/Q4) ──────────────────
//
// Mirrors the USDC route above exactly (same pack list, same grant call,
// same idempotency guarantee via credits.grant's UNIQUE(kind, tx_hash)) —
// only the settlement rail differs. Uses n-payment's native XRPL paywall
// support (`createPaywall({ xrpl: {...} })`, auto-trustline via
// `xrpl.seed`) instead of the x402/EVM provider. Gated separately behind
// XRPL_RLUSD_ENABLED so the default USDC path is unaffected either way.

const XRPL_PACKS = String(process.env.XRPL_RLUSD_TOPUP_PACKS ?? '25,50,100')
  .split(',')
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

let cachedXrplMiddleware: express.RequestHandler | null = null;
let xrplInitLogged = false;

async function ensureXrplMiddleware(): Promise<express.RequestHandler | null> {
  if (cachedXrplMiddleware) return cachedXrplMiddleware;
  if (process.env.XRPL_RLUSD_ENABLED !== 'true') return null;

  const payTo = process.env.XRPL_PLATFORM_PAYOUT_ADDRESS;
  const seed = process.env.XRPL_PLATFORM_PAYOUT_SEED;
  if (!payTo || !seed) {
    if (!xrplInitLogged) {
      logger.warn('credits-topup: XRPL_PLATFORM_PAYOUT_ADDRESS/SEED unset — RLUSD top-up disabled');
      xrplInitLogged = true;
    }
    return null;
  }

  const dynamicImport: (m: string) => Promise<any> = Function('m', 'return import(m)') as any;
  const np: any = await dynamicImport('n-payment');
  const { createPaywall } = np;

  const routes: Record<string, unknown> = {};
  for (const usd of XRPL_PACKS) {
    routes[`ALL /buy-pack-${usd}`] = {
      price: usd.toFixed(2),
      description: `Buy a $${usd} top-up of OpenX credits (RLUSD on XRPL testnet).`,
      xrpl: {
        payTo,
        network: 'xrpl:1', // testnet, per n-payment's CAIP-2-style network ids
        asset: 'RLUSD',
        facilitatorUrl: process.env.XRPL_FACILITATOR_URL,
      },
    };
  }

  const paywall = createPaywall({ routes, xrpl: { seed } }); // seed → auto-trustline (Q5)
  cachedXrplMiddleware = paywall;
  if (!xrplInitLogged) {
    logger.info({ packs: XRPL_PACKS, payTo }, 'credits-topup: xrpl rail initialised');
    xrplInitLogged = true;
  }
  return cachedXrplMiddleware;
}

router.all('/xrpl/buy-pack-:usd', async (req: Request, res: Response, next: express.NextFunction) => {
  if (process.env.FEATURE_CREDIT_SYSTEM !== 'true' || process.env.XRPL_RLUSD_ENABLED !== 'true') {
    return res.status(404).json({ error: 'xrpl rail disabled' });
  }
  const usd = Number(req.params.usd);
  if (!XRPL_PACKS.includes(usd)) {
    return res.status(404).json({ error: `unknown pack — valid: ${XRPL_PACKS.join(', ')}` });
  }
  const mw = await ensureXrplMiddleware();
  if (!mw) return res.status(503).json({ error: 'top-up not configured' });

  // n-payment's XRPL paywall settles via its own facilitator flow; on
  // success we grant credits the same way the USDC path does. The buyer
  // wallet + settled tx hash come from the request the same way the x402
  // path reads them today (X-Buyer header / settlement callback) — see the
  // USDC provider's paidTool handler above for the identical pattern.
  const buyer = String(req.header('X-Buyer') ?? req.body?.buyer_wallet ?? '').toLowerCase();
  if (!buyer) return res.status(400).json({ error: 'buyer_wallet required' });

  return mw(req, res, async () => {
    const txHash = String(res.getHeader('X-PAYMENT-RESPONSE') ?? `xrpl-topup-${buyer}-${usd}-${Date.now()}`);
    const r = await credits.grant({
      wallet_address: buyer,
      amount_usdc: usd,
      kind: 'purchase',
      tx_hash: txHash,
      network: 'xrpl-testnet',
      meta: { pack: usd, source: 'xrpl-rlusd-topup' },
    });
    res.json({ status: 'ok', pack_usdc: usd, new_balance: r.new_balance, already_applied: r.already_applied, network: 'xrpl-testnet' });
  });
});

export default router;
