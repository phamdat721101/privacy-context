import { AGENT_BACKEND_URL } from './contracts';

/**
 * Public-facing agent shape. The UI never imports the API's `Brain` type —
 * this module is the single boundary where brain → agent translation happens.
 */
export interface Agent {
  id: number;
  title: string;
  description: string;
  tags: string[];
  ownerAddress: string;
  published: boolean;
  createdAt?: string;
  /** Optional pricing surface — derived in UI for now since the API
   * doesn't yet store per-agent pricing. */
  price?: { amount: string; currency: string };
  /** Public slug of the published x402 API, if any. */
  slug?: string;
  /** True if seller opted into confidential-amount payments. */
  acceptsPrivate?: boolean;
}

interface BrainDto {
  id: number;
  owner_address: string;
  title: string;
  description?: string | null;
  tags?: string[] | null;
  published?: boolean;
  created_at?: string;
}

function brainToAgent(b: BrainDto): Agent {
  return {
    id: b.id,
    title: b.title || `📝 Untitled · Agent #${b.id}`,
    description: b.description || 'Encrypted AI agent powered by Fhenix CoFHE.',
    tags: Array.isArray(b.tags) ? b.tags : [],
    ownerAddress: b.owner_address,
    published: !!b.published,
    createdAt: b.created_at,
  };
}

export async function listAgents(query?: string): Promise<Agent[]> {
  const url = query
    ? `${AGENT_BACKEND_URL}/brains/search?q=${encodeURIComponent(query)}`
    : `${AGENT_BACKEND_URL}/brains`;
  const [brainsRes, paidRes] = await Promise.all([
    fetch(url),
    fetch(`${AGENT_BACKEND_URL}/v3/agents`).catch(() => null),
  ]);
  if (!brainsRes.ok) return [];
  const brainData = (await brainsRes.json()) as BrainDto[];
  const agents = brainData.map(brainToAgent);

  // Merge in slug + pricing from /v3/agents (paid API records, keyed by brain_id).
  if (paidRes && paidRes.ok) {
    try {
      const paid = await paidRes.json() as Array<{
        brain_id: number;
        slug?: string;
        pricing?: { x402?: string | null; fherc20?: string | null };
      }>;
      const byBrain = new Map(paid.map((p) => [p.brain_id, p]));
      for (const a of agents) {
        const p = byBrain.get(a.id);
        if (!p) continue;
        a.slug = p.slug;
        if (p.pricing?.x402) a.price = { amount: p.pricing.x402, currency: 'USDC' };
        if (p.pricing?.fherc20) a.acceptsPrivate = true;
      }
    } catch {/* leave unenriched */}
  }
  return agents;
}

export async function getAgent(id: string | number): Promise<Agent | null> {
  const r = await fetch(`${AGENT_BACKEND_URL}/brains/${id}`);
  if (!r.ok) return null;
  const data = (await r.json()) as BrainDto;
  return brainToAgent(data);
}

export async function listMyAgents(walletAddress: string): Promise<Agent[]> {
  const r = await fetch(`${AGENT_BACKEND_URL}/brains/mine`, {
    headers: { 'x-wallet-address': walletAddress },
  });
  if (!r.ok) return [];
  const data = (await r.json()) as BrainDto[];
  return data.map(brainToAgent);
}

export async function createAgent(walletAddress: string, title: string): Promise<Agent | null> {
  const r = await fetch(`${AGENT_BACKEND_URL}/brains/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-wallet-address': walletAddress },
    body: JSON.stringify({ title }),
  });
  if (!r.ok) return null;
  return brainToAgent((await r.json()) as BrainDto);
}

export async function publishAgent(
  walletAddress: string,
  agentId: number,
  title: string,
  tags: string[] = [],
): Promise<boolean> {
  const r = await fetch(`${AGENT_BACKEND_URL}/brains/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-wallet-address': walletAddress },
    body: JSON.stringify({ brainId: agentId, title, tags }),
  });
  return r.ok;
}

/**
 * Cognitive snapshot for an agent's underlying brain. Public — no auth — but
 * counts/topics/attestations only (no plaintext bodies). Used by the brain
 * detail page to replace the hardcoded "Capabilities" / "$15/mo" mock data.
 *
 * Returns null when the brain has no cognitive activity yet (fresh brain or
 * pre-Cognitive-v1 brain) — caller falls back to the metadata-only view.
 */
export interface AgentCognitiveSnapshot {
  brainId: number;
  episodes: number;
  facts: number;
  skills: number;
  topics: Array<{ key: string; count: number }>;
  activity14d: number[];
  lastQueryAt: string | null;
  fhenixVaultAddress: string | null;
  recentSkills: Array<{ id: string; procedureKey: string; defaultPriceUsdc: string; runCount: number }>;
  recentAttestations: Array<{ runId: number; attestation: string; createdAt: string }>;
}

export async function getAgentCognitiveSnapshot(
  brainId: number | string,
): Promise<AgentCognitiveSnapshot | null> {
  const r = await fetch(`${AGENT_BACKEND_URL}/v4/cognitive/brain/${brainId}/snapshot`);
  if (!r.ok) return null;
  return r.json() as Promise<AgentCognitiveSnapshot>;
}
