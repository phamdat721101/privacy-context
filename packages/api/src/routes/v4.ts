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
  findByOwner,
  findRelevant,
  findDecisions,
  getOne,
  listByAgent,
  listDecisionsByAgent,
  writeDecision,
  writeLearned,
} from '../services/arkivMemoryService';
import { llmChat } from '../services/chat';
import type { LearnedFact, AgentDecision } from '@fhe-ai-context/sdk';
import type { Hex } from 'viem';

const v4 = Router();

// ─── /v4/version — public diagnostic ────────────────────────────────────────

v4.get('/version', (_req: Request, res: Response) => {
  res.json({
    api: 'openx-v4',
    tier: 'arkiv-memory',
    config: arkivConfigSummary(),
    routes: [
      '/memory', '/memory/by-agent/:id', '/memory/find', '/memory/:key/extend',
      '/decisions', '/decisions/by-agent/:id', '/decisions/find',
      '/chat-with-memory', '/onboard/unfurl',
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

// ─── /v4/onboard/unfurl — URL → og:tags preview (helps users save links) ────

const UNFURL_TIMEOUT_MS = 5_000;
const UNFURL_MAX_BYTES = 1_000_000; // 1 MB — covers any sane HTML head

v4.get('/onboard/unfurl', async (req: Request, res: Response) => {
  try {
    const raw = String(req.query.url ?? '');
    let url: URL;
    try { url = new URL(raw); } catch { return res.status(400).json({ error: 'invalid url' }); }
    if (!/^https?:$/.test(url.protocol)) return res.status(400).json({ error: 'http(s) only' });
    // Block private + loopback ranges to prevent SSRF.
    if (/^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.0\.0\.0|::1)/.test(url.hostname)) {
      return res.status(400).json({ error: 'private host blocked' });
    }

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), UNFURL_TIMEOUT_MS);
    let html = '';
    try {
      const r = await fetch(url.toString(), { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': 'OpenX-Unfurl/1.0' } });
      if (!r.ok) return res.status(502).json({ error: `upstream ${r.status}` });
      // Read up to UNFURL_MAX_BYTES of the HTML head, then stop.
      const buf = new Uint8Array(UNFURL_MAX_BYTES);
      const reader = r.body?.getReader();
      if (!reader) return res.status(502).json({ error: 'no body' });
      let off = 0;
      while (off < UNFURL_MAX_BYTES) {
        const { value, done } = await reader.read();
        if (done) break;
        const room = UNFURL_MAX_BYTES - off;
        const slice = value.length > room ? value.slice(0, room) : value;
        buf.set(slice, off);
        off += slice.length;
      }
      html = new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(0, off));
    } finally { clearTimeout(t); }

    // Tiny meta extractor — no parser dependency. Looks for og:* / twitter:* / <title>.
    function meta(name: string): string | null {
      const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i');
      const m = html.match(re);
      return m ? m[1] : null;
    }
    const titleMeta = meta('og:title') ?? meta('twitter:title') ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? null;
    const descMeta = meta('og:description') ?? meta('twitter:description') ?? meta('description');
    const imageMeta = meta('og:image') ?? meta('twitter:image');

    res.json({
      url: url.toString(),
      hostname: url.hostname,
      title: titleMeta?.trim().slice(0, 200) ?? null,
      description: descMeta?.trim().slice(0, 400) ?? null,
      image: imageMeta?.trim().slice(0, 500) ?? null,
    });
  } catch (err) {
    const e = err as Error & { name?: string };
    if (e.name === 'AbortError') return res.status(504).json({ error: 'unfurl timeout' });
    res.status(500).json({ error: e.message });
  }
});

v4.post('/chat-with-memory', async (req: Request, res: Response) => {
  try {
    const { question, ownedBy, topic, limit } = req.body as { question?: string; ownedBy?: string; topic?: string; limit?: number };
    if (!question || !ownedBy) return res.status(400).json({ error: 'question and ownedBy required' });

    const { facts, entityKeys } = await findByOwner({
      ownedBy: ownedBy as Hex,
      topic,
      limit: Math.min(limit ?? 12, 25),
    });

    if (facts.length === 0) {
      res.json({
        answer: "I don't see any memories on that topic in your wallet's namespace yet. Save a few facts and ask again.",
        citations: [],
        memoriesConsidered: 0,
      });
      return;
    }

    // Strict prompt: never invent. Only cite provided memories.
    const indexed = facts.map((f, i) => `[${i + 1}] ${f.fact} (confidence ${f.confidence}, ${new Date(f.derivedAt).toISOString().slice(0, 10)})`).join('\n');
    const system =
      'You are the user\'s personal memory agent. Answer ONLY using the numbered memories below. ' +
      'Cite each memory you use with its bracketed index, e.g. [1]. ' +
      'If none apply, say so plainly — never invent. Be concise (≤120 words).\n\n' +
      `User memories (${facts.length}):\n${indexed}`;

    const answer = await llmChat(system, [{ role: 'user', content: question }]);

    // Build citation list — only those whose [n] reference appears in the answer.
    const cited = new Set<number>();
    for (const m of answer.matchAll(/\[(\d{1,3})\]/g)) {
      const idx = Number(m[1]);
      if (idx >= 1 && idx <= facts.length) cited.add(idx);
    }
    const citations = Array.from(cited)
      .sort((a, b) => a - b)
      .map((idx) => ({
        index: idx,
        entityKey: entityKeys[idx - 1],
        snippet: facts[idx - 1].fact.slice(0, 200),
        confidence: facts[idx - 1].confidence,
        derivedAt: facts[idx - 1].derivedAt,
      }));

    res.json({ answer, citations, memoriesConsidered: facts.length });
  } catch (err) {
    const e = err as Error & { status?: number };
    logger.error({ err: e.message }, 'v4:chat-with-memory:failed');
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

// ─── /v4/cognitive/* — Cognitive Memory v1 (L1/L2/L3) ───────────────────────
// Phase 1: free reads, free skill runs. Postgres-backed; Arkiv flow above is
// untouched. Hooks pre-shaped for Phase 2 monetization (see PRD 4).
import {
  listEpisodes,
  listFacts,
  listSkills,
  runSkill,
  getBrainSnapshot,
} from '../services/cognitiveMemoryService';

/** Require the request's x-wallet-address header to match the :addr URL param.
 *  Owner-only paths return decrypted plaintext; non-owners get 403 to avoid
 *  leaking the existence of cognitive rows for other addresses. */
function requireOwner(req: Request, res: Response): boolean {
  const wallet = String(req.headers['x-wallet-address'] ?? '').toLowerCase();
  const target = String(req.params.addr ?? '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet) || wallet !== target) {
    res.status(403).json({ error: 'x-wallet-address must match :addr (owner-only)' });
    return false;
  }
  return true;
}

v4.get('/cognitive/episodes/by-owner/:addr', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const items = await listEpisodes(req.params.addr, { limit });
    res.json({ items });
  } catch (err) {
    const e = err as Error & { status?: number };
    logger.warn({ err: e.message }, 'v4:cognitive:episodes:failed');
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

v4.get('/cognitive/facts/by-owner/:addr', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const items = await listFacts(req.params.addr, { limit });
    res.json({ items });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

v4.get('/cognitive/skills/by-owner/:addr', async (req: Request, res: Response) => {
  if (!requireOwner(req, res)) return;
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const items = await listSkills(req.params.addr, { limit });
    res.json({ items });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

v4.post('/cognitive/skills/:id/run', async (req: Request, res: Response) => {
  try {
    const buyer = (req.headers['x-wallet-address'] as string) ?? 'agent-anonymous';
    const r = await runSkill(req.params.id, buyer, req.body?.input);
    res.json(r);
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

v4.get('/cognitive/brain/:brainId/snapshot', async (req: Request, res: Response) => {
  try {
    const brainId = Number(req.params.brainId);
    if (!Number.isFinite(brainId)) return res.status(400).json({ error: 'brainId must be numeric' });
    const snap = await getBrainSnapshot(brainId);
    if (!snap) return res.status(404).json({ error: 'brain not found' });
    res.json(snap);
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

export default v4;
