/**
 * v3-marketplace — seller-first marketplace v1 routes.
 *
 *   GET  /v3/marketplace/listings           public (whitelisted in auth.ts)
 *   POST /v3/marketplace/seller/publish     auth-gated atomic publish
 *
 * Mounted from server.ts behind the shared `auth` middleware.
 * /listings opts out of auth via PUBLIC_PATHS so anonymous browsers + the
 * /seller/onboard success card can hit it before any wallet has connected.
 *
 * Buyer-side concierge (PRD-08), Stripe Connect (PRD-10), reviews (PRD-12),
 * and GTM (PRD-13) are explicitly NOT in this file — each gets its own
 * router when those PRDs land.
 */

import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../lib';
import type { AuthRequest } from '../middleware/auth';
import { publish, type SellerPublishInput } from '../services/sellerPublishService';

const router = Router();

const VALID_DOMAINS = new Set([
  'marketing',
  'finance',
  'research',
  'engineering',
  'generalist',
  'other',
]);
const VALID_TIERS = new Set(['basic', 'verified', 'tee_attested']);

router.get('/listings', async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 100);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  const domain =
    typeof req.query.domain === 'string' && VALID_DOMAINS.has(req.query.domain)
      ? req.query.domain
      : null;
  const tier =
    typeof req.query.tier === 'string' && VALID_TIERS.has(req.query.tier)
      ? req.query.tier
      : null;

  const params: Array<string | number> = [limit, offset];
  let where = `WHERE a.published = true`;
  if (domain) {
    params.push(domain);
    where += ` AND a.domain = $${params.length}`;
  }
  if (tier) {
    params.push(tier);
    where += ` AND a.verification_tier = $${params.length}`;
  }

  const r = await pool.query(
    `SELECT a.id,
            a.brain_id,
            a.slug,
            a.chain,
            a.domain,
            a.short_description,
            a.verification_tier,
            a.pricing,
            a.persona,
            a.created_at,
            b.title,
            b.description,
            b.tags
       FROM agents a
       JOIN brains b ON b.id = a.brain_id
       ${where}
   ORDER BY a.created_at DESC
      LIMIT $1 OFFSET $2`,
    params,
  );
  res.json({ listings: r.rows, limit, offset });
});

router.post('/seller/publish', async (req: AuthRequest, res: Response) => {
  if (!req.user?.address) {
    return res.status(401).json({ error: 'auth required' });
  }
  try {
    const apiBaseUrl = `${req.protocol}://${req.get('host')}`;
    const result = await publish(req.user.address, req.body as SellerPublishInput, {
      apiBaseUrl,
    });
    logger.info(
      { wallet: req.user.address, slug: result.slug, domain: result.domain, chain: result.chain },
      'marketplace:seller:publish:ok',
    );
    res.json(result);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    const status = typeof err?.status === 'number' ? err.status : 500;
    logger.warn(
      { wallet: req.user.address, err: err?.message, status },
      'marketplace:seller:publish:failed',
    );
    res.status(status).json({ error: err?.message ?? 'publish failed' });
  }
});

export default router;
