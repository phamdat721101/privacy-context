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
  const r = await fetch(url);
  if (!r.ok) return [];
  const data = (await r.json()) as BrainDto[];
  return data.map(brainToAgent);
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
