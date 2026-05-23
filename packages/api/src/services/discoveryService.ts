import { pool } from '../db';
import { issueBundle, BundleStep, BundleManifest } from './bundleService';

/**
 * discoveryService — turns a free-text requirements message into a list of
 * candidate agents and emits a signed BundleManifest with the recommended
 * sequence.
 *
 * Ranking algo (v1, mock-first): TF-IDF over published agent personas +
 * tags. Real-prod swap = embed-search via the existing rag service. The
 * concierge does NOT call an LLM in v1 — keeping latency predictable and
 * deploy-simple. T13 backlog: add an LLM-driven persona-summarisation step
 * once provider personas are richer.
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

const STOP = new Set([
  'a','an','the','of','to','for','and','or','in','on','i','need','want','help','with','my','me','you','an',
  'is','are','be','can','do','does','this','that','these','those','please','it','its','as','by','from','at',
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

function score(query: string[], doc: string[]): number {
  if (doc.length === 0) return 0;
  const docSet = new Set(doc);
  let s = 0;
  for (const t of query) if (docSet.has(t)) s += 1;
  return s / Math.sqrt(doc.length);
}

export async function discover(input: DiscoverInput, baseUrl: string): Promise<DiscoverResult> {
  const max = Math.min(input.max_steps ?? 3, 5);
  const q = tokenize(input.message);
  if (q.length === 0) return { candidates: [], bundle: null };

  const r = await pool.query(
    `SELECT id, brain_id, owner_address, chain, persona, pricing, kya_required, min_reputation
     FROM agents WHERE published = true LIMIT 200`,
  );

  const ranked = r.rows
    .map((a) => {
      const sys = (a.persona?.system_prompt ?? '') as string;
      const tools = ((a.persona?.tools ?? []) as string[]).join(' ');
      const doc = tokenize(`${sys} ${tools}`);
      const sc = score(q, doc);
      return {
        agent: a,
        score: sc,
        persona_summary: sys.slice(0, 140),
      };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);

  if (ranked.length === 0) return { candidates: [], bundle: null };

  // Pick a rail per agent: preferred_rail if priced, else cheapest rail with a non-null price.
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
      description: (agent.persona?.system_prompt ?? '').slice(0, 80),
    });
  }

  const bundle = steps.length ? await issueBundle({ steps }) : null;

  return {
    candidates: ranked.map(({ agent, score: sc, persona_summary }) => ({
      agent_id: agent.id,
      score: sc,
      reason: `Matched ${Math.round(sc * 100) / 100} on persona keywords.`,
      persona_summary,
      pricing: agent.pricing,
      chain: agent.chain,
    })),
    bundle,
  };
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
