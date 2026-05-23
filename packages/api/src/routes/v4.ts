/**
 * /v4 — Arkiv Memory Tier (Web3 Database Builder Challenge).
 *
 * Mounted *without* parent auth: writes opt-in to auth, reads are public.
 * Pay-to-extend uses an inline HMAC paywall keyed on the same PAYMENT_SECRET
 * as v3's paymentGate, so receipts are interchangeable.
 *
 * Endpoints:
 *   POST /v4/memory                       (auth) — write a signed LearnedFact
 *   GET  /v4/memory/:entityKey            public  — read one entity
 *   GET  /v4/memory/by-agent/:agentId     public  — list per agent (paginated)
 *   POST /v4/memory/find                  public  — query by topic+confidence
 *   POST /v4/memory/:entityKey/extend     paid   — bump TTL via x402 USDC ($0.01)
 *   GET  /v4/version                      public  — diagnostic (Arkiv config status)
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { auth, type AuthRequest } from '../middleware/auth';
import { logger } from '../lib';
import {
  arkivConfigSummary,
  extend,
  findRelevant,
  findDecisions,
  getOne,
  listByAgent,
  listDecisionsByAgent,
  writeDecision,
  writeLearned,
} from '../services/arkivMemoryService';
import type { LearnedFact, AgentDecision } from '@fhe-ai-context/sdk';
import type { Hex } from 'viem';

const v4 = Router();

// ─── /v4/version — public diagnostic ────────────────────────────────────────

v4.get('/version', (_req: Request, res: Response) => {
  res.json({
    api: 'fhedin-v4',
    tier: 'arkiv-memory',
    config: arkivConfigSummary(),
    routes: [
      '/memory', '/memory/by-agent/:id', '/memory/find', '/memory/:key/extend',
      '/decisions/by-agent/:id', '/decisions/find',
    ],
    entityTypes: ['agent-memory', 'agent-decision'],
  });
});

// ─── /v4/memory — write (auth required) ─────────────────────────────────────

v4.post('/memory', auth, async (req: AuthRequest, res: Response) => {
  try {
    const { fact, topic, expiresInSeconds } = req.body as { fact: LearnedFact; topic: string; expiresInSeconds?: number };
    if (!fact || !topic) return res.status(400).json({ error: 'fact and topic required' });
    if (!fact.signer || !fact.signature) return res.status(400).json({ error: 'fact.signer and fact.signature required (sign canonicalize() with the agent wallet)' });
    if (req.user?.address && fact.signer.toLowerCase() !== req.user.address.toLowerCase()) {
      return res.status(403).json({ error: 'fact.signer must match x-wallet-address (the Memory-Agent itself writes its memory)' });
    }
    const r = await writeLearned(fact, topic, expiresInSeconds);
    res.json(r);
  } catch (err) {
    const e = err as Error & { status?: number };
    logger.warn({ err: e.message }, 'v4:memory:write:failed');
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

// ─── /v4/memory/find — public typed query ────────────────────────────────────

v4.post('/memory/find', async (req: Request, res: Response) => {
  try {
    const { agentId, topic, minConfidence, limit } = req.body ?? {};
    if (!agentId) return res.status(400).json({ error: 'agentId required' });
    const r = await findRelevant({ agentId: agentId as Hex, topic, minConfidence, limit });
    res.json({ count: r.facts.length, facts: r.facts, entityKeys: r.entityKeys });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

// ─── /v4/memory/by-agent/:agentId — public list (paginated) ─────────────────

v4.get('/memory/by-agent/:agentId', async (req: Request, res: Response) => {
  try {
    const cursor = (req.query.cursor as string | undefined) ?? undefined;
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    const r = await listByAgent(req.params.agentId as Hex, cursor, limit);
    res.json(r);
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

// ─── /v4/memory/:entityKey — public single entity ────────────────────────────

v4.get('/memory/:entityKey', async (req: Request, res: Response) => {
  try {
    const r = await getOne(req.params.entityKey);
    res.json(r);
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

// ─── /v4/decisions/* — agent-decision (2nd entity type, AI reputation log) ──

v4.post('/decisions', auth, async (req: AuthRequest, res: Response) => {
  try {
    const { decision, topic, expiresInSeconds } = req.body as { decision: AgentDecision; topic: string; expiresInSeconds?: number };
    if (!decision || !topic) return res.status(400).json({ error: 'decision and topic required' });
    if (!decision.signer || !decision.signature) return res.status(400).json({ error: 'decision.signer and decision.signature required (sign canonicalize() with the agent wallet)' });
    if (req.user?.address && decision.signer.toLowerCase() !== req.user.address.toLowerCase()) {
      return res.status(403).json({ error: 'decision.signer must match x-wallet-address (the Memory-Agent itself signs its decisions)' });
    }
    const r = await writeDecision(decision, topic, expiresInSeconds);
    res.json(r);
  } catch (err) {
    const e = err as Error & { status?: number };
    logger.warn({ err: e.message }, 'v4:decisions:write:failed');
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

v4.get('/decisions/by-agent/:agentId', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    const r = await listDecisionsByAgent(req.params.agentId as Hex, limit);
    res.json(r);
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

v4.post('/decisions/find', async (req: Request, res: Response) => {
  try {
    const { agentId, topic, decision, limit } = req.body ?? {};
    if (!agentId) return res.status(400).json({ error: 'agentId required' });
    const r = await findDecisions({ agentId: agentId as Hex, topic, decision, limit });
    res.json({ count: r.decisions.length, decisions: r.decisions, entityKeys: r.entityKeys });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

// ─── /v4/memory/:entityKey/extend — pay-to-extend (x402 USDC) ───────────────

const PAYMENT_SECRET = process.env.PAYMENT_SECRET ?? 'dev-only-payment-secret-please-rotate';
const EXTEND_PRICE_USDC = process.env.MEMORY_EXTEND_USDC ?? '0.01';
const EXTEND_TTL_SECONDS = Number(process.env.MEMORY_DEFAULT_TTL_SECONDS ?? 60 * 60 * 24 * 30);

interface ExtendChallenge { rail: 'x402'; amount_usdc: string; endpoint: string; expires_at: number }

function signExtend(b: ExtendChallenge): string {
  const canonical = JSON.stringify(b);
  const sig = crypto.createHmac('sha256', PAYMENT_SECRET).update(canonical).digest('base64url');
  return `${Buffer.from(canonical).toString('base64url')}.${sig}`;
}
function verifyExtend(token: string): ExtendChallenge | null {
  try {
    const [bodyB64, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', PAYMENT_SECRET).update(Buffer.from(bodyB64, 'base64url')).digest('base64url');
    if (sig !== expected) return null;
    const body: ExtendChallenge = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'));
    if (body.expires_at < Date.now()) return null;
    return body;
  } catch { return null; }
}

function extendPaywall(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Payment ')) {
    const id = signExtend({ rail: 'x402', amount_usdc: EXTEND_PRICE_USDC, endpoint: req.originalUrl, expires_at: Date.now() + 5 * 60 * 1000 });
    res.append('WWW-Authenticate', `Payment id="${id}", method="exact", currency="USDC", amount="${EXTEND_PRICE_USDC}"`);
    res.status(402).type('application/problem+json').json({
      type: 'https://paymentauth.org/problems/payment-required',
      title: 'Payment Required',
      status: 402,
      detail: `Pay ${EXTEND_PRICE_USDC} USDC to extend this memory by ${EXTEND_TTL_SECONDS}s.`,
      rails: [{ rail: 'x402', amount: EXTEND_PRICE_USDC }],
    });
    return;
  }
  const [, method, challengeId, receipt] = auth.split(/\s+/);
  const body = verifyExtend(challengeId ?? '');
  if (!body || method !== 'exact' || !receipt || receipt.length < 4) {
    res.status(402).json({ error: 'invalid payment receipt' });
    return;
  }
  next();
}

v4.post('/memory/:entityKey/extend', extendPaywall, async (req: Request, res: Response) => {
  try {
    const r = await extend(req.params.entityKey, EXTEND_TTL_SECONDS);
    res.json({ ...r, extendedSeconds: EXTEND_TTL_SECONDS });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

export default v4;
