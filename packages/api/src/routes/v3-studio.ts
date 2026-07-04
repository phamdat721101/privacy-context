/**
 * v3-studio — PRD-V seller portal read-side endpoints.
 *
 * Mounted at `/v3` in server.ts. All endpoints owner-gated via
 * `x-wallet-address` from the parent /v3 auth middleware, then a per-agent
 * ownership check inside `studioService`.
 *
 * Feature flag: FEATURE_SELLER_PORTAL_V1 (via isOpenxV2SubFlagOn cascade
 * so FEATURE_OPENX_V2=false disables the whole portal). When off, every
 * endpoint returns 501 and the frontend `/studio` falls back to the
 * Jul 3 legacy mega-page (byte-identical rollback).
 *
 * SOLID:
 *   • SRP — HTTP shell + error mapping only. All aggregation in studioService.
 *   • DIP — imports the singleton; tests substitute at module level.
 */

import { Router, type Response } from 'express';
import { logger, isOpenxV2SubFlagOn } from '../lib';
import type { AuthRequest } from '../middleware/auth';
import { studioService, StudioError } from '../services/studioService';

const router = Router();

function gate(req: AuthRequest, res: Response): string | null {
  if (!isOpenxV2SubFlagOn('FEATURE_SELLER_PORTAL_V1')) {
    res.status(501).json({ error: 'not_implemented', reason: 'FEATURE_SELLER_PORTAL_V1=false' });
    return null;
  }
  const owner = req.user?.address;
  if (!owner) {
    res.status(401).json({ error: 'auth_required' });
    return null;
  }
  return owner;
}

function handleError(res: Response, err: unknown, ctx: string): Response {
  if (err instanceof StudioError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  const msg = (err as Error).message ?? 'internal_error';
  logger.error({ err: msg, ctx }, 'v3-studio:error');
  return res.status(500).json({ error: 'internal_error', message: msg.slice(0, 200) });
}

// ─── 1. GET /v3/studio/agents ────────────────────────────────────────────

router.get('/studio/agents', async (req: AuthRequest, res: Response) => {
  const owner = gate(req, res);
  if (!owner) return;
  try {
    const result = await studioService.listSellerAgents(owner);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err, 'listSellerAgents');
  }
});

// ─── 2. GET /v3/studio/agents/:id ────────────────────────────────────────

router.get('/studio/agents/:id', async (req: AuthRequest, res: Response) => {
  const owner = gate(req, res);
  if (!owner) return;
  try {
    const result = await studioService.getAgentOverview(req.params.id, owner);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err, 'getAgentOverview');
  }
});

// ─── 3. GET /v3/studio/agents/:id/tasks?role=primary|sub|all&limit&offset ─

router.get('/studio/agents/:id/tasks', async (req: AuthRequest, res: Response) => {
  const owner = gate(req, res);
  if (!owner) return;
  const roleRaw = String(req.query.role ?? 'all').toLowerCase();
  const role: 'primary' | 'sub' | 'all' =
    roleRaw === 'primary' || roleRaw === 'sub' ? roleRaw : 'all';
  const limit = Math.max(1, Math.min(100, Number(req.query.limit ?? 20)));
  const offset = Math.max(0, Number(req.query.offset ?? 0));
  try {
    const result = await studioService.getAgentTasks(req.params.id, owner, { role, limit, offset });
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err, 'getAgentTasks');
  }
});

// ─── 4. GET /v3/studio/agents/:id/dream/runs ─────────────────────────────

router.get('/studio/agents/:id/dream/runs', async (req: AuthRequest, res: Response) => {
  const owner = gate(req, res);
  if (!owner) return;
  try {
    const result = await studioService.getDreamRuns(req.params.id, owner);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err, 'getDreamRuns');
  }
});

// ─── 5. GET /v3/studio/agents/:id/revenue ────────────────────────────────

router.get('/studio/agents/:id/revenue', async (req: AuthRequest, res: Response) => {
  const owner = gate(req, res);
  if (!owner) return;
  try {
    const result = await studioService.getRevenue(req.params.id, owner);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err, 'getRevenue');
  }
});

export default router;
