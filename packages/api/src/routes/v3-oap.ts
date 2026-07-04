/**
 * v3-oap — OpenX Agent Protocol (OAP) registration (PRD-U1).
 *
 * Mounted at `/v3` in server.ts. Endpoint:
 *   POST /v3/oap/register
 *     Body: EXACTLY ONE of:
 *       { manifest_url: "https://…/.well-known/openx-agent.json" }  ← URL mode
 *       { manifest: {…} }                                            ← inline JSON
 *       { prompt: "This agent translates English to Vietnamese…" }   ← NL fallback
 *     Auth: standard `x-wallet-address` (or `x-openx-token` envelope) via
 *           the parent `/v3` mount's auth middleware.
 *
 * Behind FEATURE_OAP_REGISTRATION=true; returns 501 otherwise. Any other
 * runtime flag is untouched — auth, agent-kya, rate-limiter, all inherit
 * from the parent /v3 mount so this router adds zero new middleware paths.
 *
 * SOLID:
 *   • SRP — HTTP shell + input dispatch only. All logic lives in oapService
 *           (URL / inline modes) or conciergeOnboardService (NL fallback).
 *   • DIP — imports the shared singletons; tests substitute at module level.
 */

import { Router, Response } from 'express';
import { logger, isOpenxV2SubFlagOn } from '../lib';
import type { AuthRequest } from '../middleware/auth';
import { oapService, OapError, type RegistrationSource } from '../services/oapService';
import { conciergeOnboardService } from '../services/conciergeOnboardService';

const router = Router();

// ─── POST /v3/oap/register ─────────────────────────────────────────────────

router.post('/oap/register', async (req: AuthRequest, res: Response) => {
  if (!isOpenxV2SubFlagOn('FEATURE_OAP_REGISTRATION')) {
    return res
      .status(501)
      .json({ error: 'not_implemented', reason: 'FEATURE_OAP_REGISTRATION=false' });
  }

  const ownerAddress = req.user?.address;
  if (!ownerAddress) return res.status(401).json({ error: 'auth_required' });

  const body = (req.body ?? {}) as {
    manifest_url?: unknown;
    manifest?: unknown;
    prompt?: unknown;
  };

  // Exactly-one-of guard — refuse ambiguous inputs at the boundary.
  const modes = [
    body.manifest_url !== undefined ? 'url' : null,
    body.manifest !== undefined ? 'inline' : null,
    body.prompt !== undefined ? 'nl_fallback' : null,
  ].filter(Boolean) as Array<'url' | 'inline' | 'nl_fallback'>;

  if (modes.length === 0) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'Provide exactly one of: manifest_url, manifest, prompt',
    });
  }
  if (modes.length > 1) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'Provide exactly one of: manifest_url, manifest, prompt (not multiple)',
    });
  }

  try {
    switch (modes[0]) {
      case 'url':
        return void (await handleUrlMode(res, ownerAddress, body.manifest_url as string));
      case 'inline':
        return void (await handleInlineMode(res, ownerAddress, body.manifest));
      case 'nl_fallback':
        return void (await handleNlMode(req, res, body.prompt as string));
    }
  } catch (err) {
    if (err instanceof OapError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    logger.error({ err: (err as Error).message }, 'v3-oap:register:error');
    return res.status(500).json({ error: 'internal_error', message: 'Registration failed' });
  }
});

// ─── mode handlers — each returns a Response ────────────────────────────

async function handleUrlMode(res: Response, ownerAddress: string, url: unknown): Promise<Response> {
  if (typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'bad_request', message: 'manifest_url must be a non-empty string' });
  }
  const json = await oapService.fetchManifest(url);
  return await registerAndRespond(res, json, ownerAddress, 'url', { manifestUrl: url });
}

async function handleInlineMode(
  res: Response,
  ownerAddress: string,
  manifest: unknown,
): Promise<Response> {
  return await registerAndRespond(res, manifest, ownerAddress, 'inline');
}

async function handleNlMode(req: AuthRequest, res: Response, prompt: unknown): Promise<Response> {
  if (typeof prompt !== 'string' || prompt.trim().length < 30 || prompt.length > 2000) {
    return res.status(400).json({
      error: 'invalid_prompt',
      message: 'prompt must be 30-2000 characters.',
    });
  }
  // Delegate to the shipped Jun-26 concierge onboard path. Same result
  // shape (agent_id + slug + paywall_url) reaches the caller. Rate-limit
  // + Turnstile gates in /v3/concierge/onboard do NOT re-apply here —
  // callers hitting /oap/register have already passed the /v3 auth wall.
  const ip =
    (req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ?? '') ||
    req.socket.remoteAddress ||
    'unknown';
  const result = await conciergeOnboardService.onboardPublicAgent({
    prompt: prompt.trim(),
    request_ip: ip,
    user_agent: req.headers['user-agent']?.toString(),
  });
  if (result.status === 'needs_clarification') return res.status(400).json(result);
  if (result.status === 'duplicate') return res.status(409).json(result);
  // Live result — normalize to the OAP registration response shape so
  // MCP + curl callers get one predictable payload regardless of mode.
  return res.status(200).json({
    agent_id: result.agent_id,
    slug: result.slug,
    manifest_hash: null,
    listing_url: result.agent_url,
    paywall_url: result.paywall_url,
    curl_example: result.curl_example,
    source: 'nl_fallback' as const,
    manifest: result.manifest,
  });
}

async function registerAndRespond(
  res: Response,
  json: unknown,
  ownerAddress: string,
  source: RegistrationSource,
  opts: { manifestUrl?: string } = {},
): Promise<Response> {
  const validation = oapService.validateManifest(json);
  if ('reason' in validation) {
    return res.status(400).json({ error: 'invalid_manifest', message: validation.reason });
  }
  const result = await oapService.registerFromManifest(
    validation.manifest,
    ownerAddress,
    source,
    opts,
  );
  return res.status(200).json({ ...result, source });
}

export default router;
