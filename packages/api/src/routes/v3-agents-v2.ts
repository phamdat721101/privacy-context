/**
 * v3-agents-v2 — envelope-aware call surface (PRD-U2).
 *
 * Mounted at `/v3` in server.ts. Endpoint:
 *   POST /v3/agents/:id/call
 *     Content-Type: application/oap+json    → typed OapEnvelope path
 *     Content-Type: application/json         → legacy { prompt: string } path
 *
 * The `oapValidation` middleware runs ONLY on this router (mounted below).
 * It's a no-op for legacy MIME requests, so the same endpoint serves both
 * paths byte-identically until the envelope is opted in via Content-Type.
 *
 * Feature flag: `FEATURE_TYPED_CONTEXT=true` enables envelope handling +
 * audit-log writes; when off, only the legacy string body path works and
 * the endpoint returns 501 for envelope requests.
 *
 * SOLID:
 *   • SRP — HTTP shell + audit-log writes only. Deterministic
 *           envelope→prompt conversion lives in the SDK (`envelopeToPrompt`).
 *   • OCP — new fields on the envelope require zero changes here; only
 *           the SDK codec grows.
 *   • DIP — takes shared `pool` + `logger` + `llmChat` at module load;
 *           tests inject via jest.mock or dependency substitution.
 */

import { Router, type Response } from 'express';
import { verifyTypedData } from 'ethers';
import { pool } from '../db';
import { logger, isOpenxV2SubFlagOn } from '../lib';
import type { AuthRequest } from '../middleware/auth';
import { oapValidation } from '../middleware/oapValidation';
import { llmChat } from '../services/chat';
import { agentOrchestrationService } from '../services/agentOrchestrationService';
import { autoDreamService } from '../services/autoDreamService';
import {
  envelopeToPrompt,
  type OapEnvelope,
  type OapResponse,
} from '@fhe-ai-context/sdk';

const router = Router();

// Apply typed-envelope validation only to this router. Sibling /v3 routers
// (v3.ts, v3-onboard.ts, v3-oap.ts) are unaffected.
router.use(oapValidation);

// ─── POST /v3/agents/:id/call ─────────────────────────────────────────────

router.post('/agents/:id/call', async (req: AuthRequest, res: Response) => {
  const agentId = req.params.id;
  if (!agentId) return res.status(400).json({ error: 'bad_request', message: 'agent id required' });

  // Envelope path is flag-gated; when off, envelopes fall through the
  // middleware pass-through and hit the legacy branch below (harmless
  // because req.oapEnvelope stays undefined).
  const envelope = req.oapEnvelope;
  const isEnvelopeCall = envelope !== undefined;

  // Load the target agent. Owner-check is on the enclosing /v3 mount's
  // auth middleware for wallet identity; per-agent ownership is enforced
  // only where mutation happens. `call` is a read-shape action — any
  // caller with a wallet may hire an agent (the paywall lives at
  // /api/v1/<slug>; /v3/agents/:id/call is the authed direct-call surface).
  const agentRow = await pool.query<{
    id: string;
    slug: string;
    persona: { system_prompt?: string; tools?: string[] } | null;
  }>(
    `SELECT id, slug, persona FROM agents WHERE id = $1 AND archived_at IS NULL LIMIT 1`,
    [agentId],
  );
  const agent = agentRow.rows[0];
  if (!agent) return res.status(404).json({ error: 'agent_not_found', agent_id: agentId });

  const systemPrompt =
    (agent.persona?.system_prompt ?? '').trim() ||
    'You are an OpenX agent. Respond concisely.';

  // Build the user prompt from either envelope (typed) or legacy string.
  let userPrompt: string;
  if (isEnvelopeCall) {
    userPrompt = envelopeToPrompt(envelope);
  } else {
    const legacyPrompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!legacyPrompt) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'send either { prompt: string } or an OapEnvelope with Content-Type: application/oap+json',
      });
    }
    userPrompt = legacyPrompt;
  }

  // Best-effort audit log for envelope calls. Non-blocking on write failure.
  if (isEnvelopeCall && process.env.FEATURE_TYPED_CONTEXT === 'true') {
    void writeEnvelopeAudit(agent.id, envelope, userPrompt.length);
  }

  // Attempt real inference. Missing provider keys → surface as 503 with a
  // clear message so smoke callers know why. Real errors propagate normally.
  try {
    const output = await llmChat(systemPrompt, [{ role: 'user', content: userPrompt }]);

    const response: OapResponse = isEnvelopeCall
      ? {
          trace_id: envelope.trace_id,
          parent_hash: envelope.parent_hash,
          output,
          tokens: { input: approxTokens(userPrompt), output: approxTokens(output) },
        }
      : {
          trace_id: `legacy-${Date.now().toString(36)}`,
          output,
          tokens: { input: approxTokens(userPrompt), output: approxTokens(output) },
        };
    return res.status(200).json(response);
  } catch (err) {
    const msg = (err as Error).message ?? 'llm_error';
    if (/no provider configured|BEDROCK_API_KEY|OPENAI_API_KEY/i.test(msg)) {
      logger.warn({ agentId }, 'v3-agents-v2:call:no-provider');
      return res.status(503).json({
        error: 'llm_unavailable',
        message: 'No LLM provider configured. Set BEDROCK_API_KEY or OPENAI_API_KEY.',
        rendered_prompt: userPrompt,
      });
    }
    logger.error({ err: msg, agentId }, 'v3-agents-v2:call:error');
    return res.status(500).json({ error: 'internal_error', message: msg.slice(0, 200) });
  }
});

// ─── POST /v3/agents/:id/orchestrate ─────────────────────────────────────
//
// PRD-U3 sub-agent orchestration. Requires an envelope (no legacy string
// fallback — orchestration is intrinsically envelope-shaped). Delegates
// to agentOrchestrationService.orchestrate which handles decompose →
// fan-out → fan-in → attestation chain writes.

router.post('/agents/:id/orchestrate', async (req: AuthRequest, res: Response) => {
  if (!isOpenxV2SubFlagOn('FEATURE_SUB_AGENT_ORCHESTRATION')) {
    return res.status(501).json({
      error: 'not_implemented',
      reason: 'FEATURE_SUB_AGENT_ORCHESTRATION=false',
    });
  }

  const agentId = req.params.id;
  const envelope = req.oapEnvelope;
  const ownerAddress = req.user?.address;

  if (!agentId) return res.status(400).json({ error: 'bad_request', message: 'agent id required' });
  if (!envelope) {
    return res.status(400).json({
      error: 'envelope_required',
      message: 'orchestrate requires Content-Type: application/oap+json + valid OapEnvelope body',
    });
  }
  if (!ownerAddress) return res.status(401).json({ error: 'auth_required' });

  try {
    const result = await agentOrchestrationService.orchestrate(agentId, envelope, ownerAddress, {
      maxSubAgents: 3,
      fallbackToSingleHop: true,
    });
    return res.status(200).json(result);
  } catch (err) {
    const status = (err as { status?: number }).status;
    const msg = (err as Error).message ?? 'orchestrate_error';
    if (status === 404) return res.status(404).json({ error: 'agent_not_found' });
    if (/no provider configured|BEDROCK_API_KEY|OPENAI_API_KEY/i.test(msg)) {
      logger.warn({ agentId }, 'v3-agents-v2:orchestrate:no-provider');
      return res.status(503).json({
        error: 'llm_unavailable',
        message: 'No LLM provider configured. Set BEDROCK_API_KEY or OPENAI_API_KEY.',
      });
    }
    logger.error({ err: msg, agentId }, 'v3-agents-v2:orchestrate:error');
    return res.status(500).json({ error: 'internal_error', message: msg.slice(0, 200) });
  }
});

// ─── POST /v3/agents/:id/dream/:runId/approve ────────────────────────────
//
// PRD-U4 seller-approve gate for auto-dream diffs. Requires the caller's
// EIP-712 signature over {run_id, agent_id, action, timestamp,
// selected_diff_ids} — this proves the seller explicitly approved THIS
// specific set of diffs and prevents replay across runs.

const EIP712_DOMAIN = { name: 'OpenX Auto-Dream', version: '1', chainId: Number(process.env.CHAIN_ID ?? 421614) };
const EIP712_TYPES = {
  DreamApproval: [
    { name: 'run_id', type: 'string' },
    { name: 'agent_id', type: 'string' },
    { name: 'action', type: 'string' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'selected_diff_ids', type: 'string[]' },
  ],
};

router.post('/agents/:id/dream/:runId/approve', async (req: AuthRequest, res: Response) => {
  if (!isOpenxV2SubFlagOn('FEATURE_AUTO_DREAM')) {
    return res.status(501).json({ error: 'not_implemented', reason: 'FEATURE_AUTO_DREAM=false' });
  }

  const agentId = req.params.id;
  const runId = req.params.runId;
  const ownerAddress = req.user?.address;
  if (!agentId || !runId) return res.status(400).json({ error: 'bad_request', message: 'agent id + run id required' });
  if (!ownerAddress) return res.status(401).json({ error: 'auth_required' });

  const body = (req.body ?? {}) as {
    action?: unknown;
    selected_diff_ids?: unknown;
    signature?: unknown;
    timestamp?: unknown;
  };
  const action = body.action;
  const signature = typeof body.signature === 'string' ? body.signature : '';
  const timestamp = typeof body.timestamp === 'number' ? body.timestamp : 0;
  const selectedDiffIds = Array.isArray(body.selected_diff_ids)
    ? body.selected_diff_ids.filter((x): x is string => typeof x === 'string')
    : [];

  if (action !== 'approve' && action !== 'reject') {
    return res.status(400).json({ error: 'bad_request', message: "action must be 'approve' or 'reject'" });
  }
  if (!signature) return res.status(400).json({ error: 'bad_request', message: 'signature required' });
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 15 * 60) {
    return res.status(400).json({ error: 'stale_signature', message: 'signature timestamp outside 15-min window' });
  }

  try {
    // ── EIP-712 verify — signer must equal req.user.address ────────────
    const message = {
      run_id: runId,
      agent_id: agentId,
      action,
      timestamp,
      selected_diff_ids: selectedDiffIds,
    };
    let recovered: string;
    try {
      recovered = verifyTypedData(EIP712_DOMAIN, EIP712_TYPES, message, signature);
    } catch (e) {
      return res.status(400).json({ error: 'invalid_signature', message: (e as Error).message.slice(0, 200) });
    }
    if (recovered.toLowerCase() !== ownerAddress.toLowerCase()) {
      return res.status(403).json({
        error: 'signature_mismatch',
        message: 'recovered signer does not match caller wallet',
      });
    }

    const result = await autoDreamService.approveDiffs(
      runId,
      agentId,
      ownerAddress,
      action,
      selectedDiffIds,
      signature,
    );
    return res.status(200).json({ ...result, action });
  } catch (err) {
    const status = (err as { status?: number }).status;
    const msg = (err as Error).message ?? 'approve_error';
    if (status === 404) return res.status(404).json({ error: 'not_found', message: msg });
    if (status === 403) return res.status(403).json({ error: 'forbidden', message: msg });
    logger.error({ err: msg, agentId, runId }, 'v3-agents-v2:dream-approve:error');
    return res.status(500).json({ error: 'internal_error', message: msg.slice(0, 200) });
  }
});

// ─── POST /v3/internal/cron/auto-dream ───────────────────────────────────
//
// Called by packages/worker/src/jobs/auto-dream-cron.ts every Sunday 03:00 UTC.
// Auth: shared secret in `x-openx-internal-secret` header (env
// OPENX_INTERNAL_SECRET). Fires + forgets — returns immediately with the
// eligible-agent count while actual dreams run in background.

router.post('/internal/cron/auto-dream', async (req: AuthRequest, res: Response) => {
  if (!isOpenxV2SubFlagOn('FEATURE_AUTO_DREAM')) {
    return res.status(501).json({ error: 'not_implemented', reason: 'FEATURE_AUTO_DREAM=false' });
  }
  const secret = process.env.OPENX_INTERNAL_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'not_configured', message: 'OPENX_INTERNAL_SECRET not set' });
  }
  const provided = req.headers['x-openx-internal-secret'];
  if (provided !== secret) {
    return res.status(403).json({ error: 'forbidden', message: 'invalid internal secret' });
  }

  try {
    const eligible = await autoDreamService.getEligibleAgents();
    // Fire-and-forget so the HTTP call returns fast. Each run is bounded
    // by phase caps + total $1.80. Concurrency is bounded to 3 in-flight
    // dreams to avoid Bedrock rate-limit thundering.
    const CONCURRENCY = 3;
    void runWithConcurrency(eligible, CONCURRENCY, async (row) => {
      try {
        await autoDreamService.run(row.agent_id);
      } catch (e) {
        logger.warn({ err: (e as Error).message, agentId: row.agent_id }, 'auto-dream-cron:run:error');
      }
    });
    return res.status(202).json({
      accepted: true,
      eligible_count: eligible.length,
      concurrency: CONCURRENCY,
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'v3-agents-v2:cron-auto-dream:error');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Bounded-concurrency runner — used by the cron endpoint above.
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const inFlight = new Set<Promise<void>>();
  for (const item of items) {
    const p = worker(item).finally(() => inFlight.delete(p));
    inFlight.add(p);
    if (inFlight.size >= concurrency) await Promise.race(inFlight);
  }
  await Promise.all(inFlight);
}

// ─── audit log write (best-effort, non-blocking) ───────────────────────────

async function writeEnvelopeAudit(
  agentId: string,
  envelope: OapEnvelope,
  inputPromptLen: number,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO oap_context_envelopes
         (trace_id, agent_id, parent_hash, envelope_json, intent_type, input_tokens)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [
        envelope.trace_id,
        agentId,
        envelope.parent_hash ?? null,
        JSON.stringify(envelope),
        envelope.intent.task_type,
        approxTokens(String(inputPromptLen)),
      ],
    );
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'oap:envelope-audit:failed');
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────

/** Cheap token approximation for observability; not billing-grade. */
function approxTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

export default router;
