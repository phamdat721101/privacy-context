import { pool } from '../db';
import { issueBundle, BundleStep, BundleManifest } from './bundleService';
import { llmChat } from './chat';

/**
 * discoveryService — turns a free-text demand into a list of candidate
 * agents and emits a signed BundleManifest with the recommended sequence.
 *
 * Two ranking strategies share one orchestrator (`discover`):
 *
 *   1. `rankWithLLM`  — primary. Feeds a compact public-metadata corpus to
 *                       Bedrock Claude (or OpenAI fallback) and asks for
 *                       structured JSON. Capped at MAX_CORPUS rows + a 60s
 *                       in-memory cache keep cost predictable.
 *   2. `rankWithTfidf` — floor strategy. Pure CPU, no external calls. Used
 *                       when LLM is disabled (`OPENX_DISCOVERY_LLM=off`),
 *                       no provider key is configured, the LLM call throws,
 *                       or the model returns malformed JSON.
 *
 * The platform is cryptographically blind to brain content (USP guarantee),
 * so the corpus only contains *public* agent metadata: persona prompt,
 * declared tools, chain, and pricing. No encrypted text crosses this
 * boundary.
 *
 * SOLID:
 *   - SRP: one service owns "rank + bundle".
 *   - OCP: new strategies plug in by returning `RankedRow[]` from the same
 *          shape; `discover` doesn't change.
 *   - DIP: `llmChat` is the only external dependency; tests stub it via
 *          jest.mock('./chat').
 */

export interface DiscoverInput {
  message: string;
  preferred_rail?: 'x402' | 'mpp' | 'sui_usdc';
  max_steps?: number;
}

export interface DiscoverResult {
  candidates: Array<{
    agent_id: string;
    score: number;
    reason: string;
    persona_summary: string;
    pricing: Record<string, string | null>;
    chain: string;
  }>;
  bundle: BundleManifest | null;
}

interface AgentDoc {
  id: string;
  brain_id: number | null;
  owner_address: string;
  chain: string;
  persona: { system_prompt?: string | null; tools?: string[] | null } | null;
  pricing: Record<string, string | null>;
  /** Brain metadata — joined in for richer TF-IDF/LLM matching. The brain
   *  title/description/tags are public and are what buyers see in the UI,
   *  so they must be part of the search corpus. */
  brain_title?: string | null;
  brain_description?: string | null;
  brain_tags?: string[] | null;
  /** Marketplace fields from agents (PRD-A). Included so concierge ranks
   *  newly published seller-wizard listings without a corpus refresh. */
  domain?: string | null;
  short_description?: string | null;
}

interface RankedRow {
  agent: AgentDoc;
  score: number;
  persona_summary: string;
  reason: string;
}

const STOP = new Set([
  'a','an','the','of','to','for','and','or','in','on','i','need','want','help','with','my','me','you',
  'is','are','be','can','do','does','this','that','these','those','please','it','its','as','by','from','at',
  // Generic verbs the buyer types when describing a demand — they leak no
  // intent and crush recall on natural-language queries like
  // "make knowledge about <topic>".
  'about','make','build','use','using','find','show','tell','give','get','know','knowledge',
]);

const MAX_CORPUS = 50;
const CORPUS_TTL_MS = 60_000;

let corpusCache: { rows: AgentDoc[]; expiresAt: number } | null = null;

/** Load the published-agent corpus, capped + cached for {@link CORPUS_TTL_MS}.
 *  LEFT JOIN brains so the brain's public surface (title, description, tags)
 *  is part of the search corpus alongside persona prompt + tools. */
async function loadCorpus(): Promise<AgentDoc[]> {
  const now = Date.now();
  if (corpusCache && corpusCache.expiresAt > now) return corpusCache.rows;
  const r = await pool.query(
    `SELECT a.id,
            a.brain_id,
            a.owner_address,
            a.chain,
            a.persona,
            a.pricing,
            b.title       AS brain_title,
            b.description AS brain_description,
            b.tags        AS brain_tags,
            a.domain,
            a.short_description
       FROM agents a
  LEFT JOIN brains b ON b.id = a.brain_id
      WHERE a.published = true
   ORDER BY a.created_at DESC
      LIMIT ${MAX_CORPUS}`,
  );
  corpusCache = { rows: r.rows as AgentDoc[], expiresAt: now + CORPUS_TTL_MS };
  return corpusCache.rows;
}

/** Public projection used as the search document. Buyers see the brain
 *  title/description first, so those have to be searchable. */
function searchableText(a: AgentDoc): string {
  const sys = (a.persona?.system_prompt ?? '') as string;
  const tools = (a.persona?.tools ?? []).join(' ');
  const title = a.brain_title ?? '';
  const desc = a.brain_description ?? '';
  const tags = (a.brain_tags ?? []).join(' ');
  // Marketplace fields lift recall on wizard-published listings.
  const domain = a.domain ?? '';
  const shortDesc = a.short_description ?? '';
  return `${title} ${desc} ${tags} ${domain} ${shortDesc} ${sys} ${tools}`.trim();
}

/** Best human-readable summary for a candidate (UI subtitle). */
function summaryOf(a: AgentDoc): string {
  return ((a.brain_description ?? a.persona?.system_prompt ?? '') as string).slice(0, 140);
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

function tfidfScore(query: string[], doc: string[]): number {
  if (doc.length === 0) return 0;
  const docSet = new Set(doc);
  let s = 0;
  for (const t of query) if (docSet.has(t)) s += 1;
  return s / Math.sqrt(doc.length);
}

function clamp01(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function rankWithTfidf(query: string, corpus: AgentDoc[], max: number): RankedRow[] {
  const q = tokenize(query);
  if (q.length === 0) return [];
  return corpus
    .map((agent) => {
      const doc = tokenize(searchableText(agent));
      const sc = tfidfScore(q, doc);
      const matched = q.filter((t) => doc.includes(t));
      return {
        agent,
        score: sc,
        persona_summary: summaryOf(agent),
        reason: matched.length
          ? `Matched keyword${matched.length === 1 ? '' : 's'}: ${matched.join(', ')}.`
          : 'Closest available match in the marketplace.',
      };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

function llmEnabled(): boolean {
  if ((process.env.OPENX_DISCOVERY_LLM ?? '').toLowerCase() === 'off') return false;
  return Boolean(process.env.BEDROCK_API_KEY || process.env.OPENAI_API_KEY);
}

/**
 * Single-shot LLM rerank. Returns null on any failure so the caller can
 * fall back to TF-IDF. Never throws.
 */
async function rankWithLLM(
  query: string,
  corpus: AgentDoc[],
  max: number,
): Promise<RankedRow[] | null> {
  if (!llmEnabled() || corpus.length === 0) return null;

  // Compact, ≤120-token-ish projection per agent. The model never sees
  // encrypted text — only the public agent surface (brain title /
  // description / tags + seller-authored persona) plus pricing.
  const compact = corpus.map((a) => ({
    id: a.id,
    title: (a.brain_title ?? '').slice(0, 80) ||
           ((a.persona?.system_prompt ?? '') as string).slice(0, 80),
    description: ((a.short_description ?? a.brain_description ?? '') as string).slice(0, 160),
    domain: a.domain ?? null,
    tags: (a.brain_tags ?? []).slice(0, 8),
    tools: (a.persona?.tools ?? []).slice(0, 5),
    pricing: a.pricing,
  }));

  const system =
    `You are OpenX's AI agent matchmaker. Given a buyer's free-text demand and a JSON ` +
    `array of published agents, return ONLY a JSON object of shape ` +
    `{ "ranked": [{ "agent_id": string, "score": number 0..1, "match_reason": string ≤80 chars }] }. ` +
    `At most ${max} entries, descending by score. Skip agents that do not genuinely match. ` +
    `If nothing matches, return { "ranked": [] }. Do not include any prose, markdown, or fences.`;

  const user = `Buyer demand: "${query}"\nAgents: ${JSON.stringify(compact)}`;

  let raw: string;
  try {
    raw = await llmChat(system, [{ role: 'user', content: user }]);
  } catch {
    return null;
  }

  // Tolerate fenced output by extracting the first balanced JSON object.
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;

  let parsed: { ranked?: Array<{ agent_id?: string; score?: unknown; match_reason?: unknown }> };
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.ranked)) return null;

  const byId = new Map(corpus.map((a) => [a.id, a]));
  const out: RankedRow[] = [];
  for (const r of parsed.ranked.slice(0, max)) {
    const a = byId.get(String(r.agent_id ?? ''));
    if (!a) continue;
    out.push({
      agent: a,
      score: clamp01(r.score),
      persona_summary: summaryOf(a),
      reason: String(r.match_reason ?? '').slice(0, 120),
    });
  }
  return out;
}

function pickRail(
  pricing: Record<string, string | null>,
  preferred?: 'x402' | 'mpp' | 'sui_usdc',
): 'x402' | 'mpp' | 'sui_usdc' | null {
  if (preferred && pricing[preferred]) return preferred;
  const order: Array<'x402' | 'mpp' | 'sui_usdc'> = ['x402', 'mpp', 'sui_usdc'];
  for (const r of order) if (pricing[r]) return r;
  return null;
}

export async function discover(input: DiscoverInput, baseUrl: string): Promise<DiscoverResult> {
  const max = Math.min(input.max_steps ?? 3, 5);
  const message = String(input.message ?? '').trim();
  if (!message) return { candidates: [], bundle: null };

  const corpus = await loadCorpus();
  if (corpus.length === 0) return { candidates: [], bundle: null };

  let ranked = await rankWithLLM(message, corpus, max);
  if (!ranked || ranked.length === 0) {
    ranked = rankWithTfidf(message, corpus, max);
  }
  if (ranked.length === 0) return { candidates: [], bundle: null };

  const steps: BundleStep[] = [];
  for (const { agent } of ranked) {
    const rail = pickRail(agent.pricing, input.preferred_rail);
    if (!rail) continue;
    const price = agent.pricing[rail] as string;
    steps.push({
      agent_id: agent.id,
      endpoint: `${baseUrl}/v3/agents/${agent.id}/chat`,
      rail,
      price_usdc: price,
      estimated_calls: 1,
      description: ((agent.persona?.system_prompt ?? '') as string).slice(0, 80),
    });
  }
  const bundle = steps.length ? await issueBundle({ steps }) : null;

  return {
    candidates: ranked.map(({ agent, score, persona_summary, reason }) => ({
      agent_id: agent.id,
      score,
      reason,
      persona_summary,
      pricing: agent.pricing,
      chain: agent.chain,
    })),
    bundle,
  };
}

/** Test-only — clear the in-memory corpus cache between runs. */
export function __resetCorpusCacheForTests() {
  corpusCache = null;
}
