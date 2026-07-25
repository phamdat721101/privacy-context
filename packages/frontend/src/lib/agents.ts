import { AGENT_BACKEND_URL } from './contracts';

/**
 * Public-facing agent shape. The UI never imports the API's `Brain` type —
 * this module is the single boundary where brain → agent translation happens.
 */
export interface Agent {
  /** Brain id (INTEGER) for legacy agents. For brain-less wizard-published
   *  agents (no `brains` row), this is instead the v3 `agents.id` UUID —
   *  see `v3AgentToAgent()` below. Typed `number` for the common case;
   *  callers that only ever `String(agent.id)` or interpolate it into a
   *  URL are safe either way. `Number(agent.id)` (e.g. re-publish flows)
   *  is only reachable when `v3AgentId` is unset, which never happens for
   *  this brain-less cohort. */
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
  /** UUID of the `agents` row (distinct from `id`, which is the brain id).
   *  Required for PATCH /v3/agents/:id from studio Settings (PRD-1). */
  v3AgentId?: string;
  /** Seller-authored persona (system prompt, etc.). PRD-1. */
  persona?: { system_prompt?: string | null; description?: string };
  /** Settlement chain stamped at create-time (e.g. 'arbitrum-sepolia',
   *  'sui-testnet'). Drives chain-aware UI labels. */
  chain?: string;
}

interface BrainDto {
  id: number;
  owner_address: string;
  title: string;
  description?: string | null;
  tags?: string[] | null;
  published?: boolean;
  created_at?: string;
  chain?: string;
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
    chain: b.chain,
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

  // Merge in slug + pricing + persona + v3 agent UUID from /v3/agents
  // (paid API records, keyed by brain_id).
  //
  // Type-safety: agents.brain_id is BIGINT in Postgres, which node-pg
  // returns as a string to avoid JS 2^53 precision loss. brains.id is
  // INTEGER and arrives as a number. Without the Number() coercion the
  // strict equality "37" === 37 silently fails — that single line was
  // the root cause of every "Studio shows Published, detail shows DRAFT"
  // bug report. Coerce ONCE at the JSON boundary so every downstream
  // comparison stays trivial.
  if (paidRes && paidRes.ok) {
    try {
      const paid = await paidRes.json() as Array<{
        id: string;
        brain_id: number | string;
        slug?: string;
        pricing?: { x402?: string | null; fherc20?: string | null };
        persona?: { system_prompt?: string | null; description?: string };
      }>;
      const byBrain = new Map(paid.map((p) => [Number(p.brain_id), p]));
      for (const a of agents) {
        const p = byBrain.get(Number(a.id));
        if (!p) continue;
        a.slug = p.slug;
        a.v3AgentId = p.id;
        a.persona = p.persona;
        if (p.pricing?.x402) a.price = { amount: p.pricing.x402, currency: 'USDC' };
        if (p.pricing?.fherc20) a.acceptsPrivate = true;
      }
    } catch {/* leave unenriched */}
  }
  return agents;
}

/** Wire shape of `GET /v3/agents/:id` — a row from the `agents` table
 *  itself, with no `brains` join. Used as the fallback source for
 *  brain-less (wizard-published) agents that `GET /brains/:id` can never
 *  resolve, since they were never backed by an encrypted `brains` row. */
interface V3AgentDto {
  id: string;
  brain_id: number | string | null;
  owner_address: string;
  chain?: string;
  persona?: { system_prompt?: string | null; description?: string } | null;
  pricing?: { x402?: string | null; fherc20?: string | null } | null;
  slug?: string | null;
  published?: boolean;
  created_at?: string;
}

/** Maps a brain-less `agents` row directly into the UI's `Agent` shape.
 *  `id` is deliberately set to the v3 agents UUID (there is no separate
 *  brain identity to distinguish it from) so `agent.id === agent.v3AgentId`
 *  for this cohort — callers that build links off `agent.id` (e.g. the
 *  "back to detail" link on /run) keep working unchanged. */
function v3AgentToAgent(a: V3AgentDto): Agent {
  return {
    id: a.id as unknown as number, // v3 UUID stands in for the numeric brain id — see doc comment above.
    title: a.persona?.description?.trim() || `📝 Agent ${a.id.slice(0, 8)}`,
    description: a.persona?.system_prompt?.trim() || 'AI agent published via the seller wizard.',
    tags: [],
    ownerAddress: a.owner_address,
    published: !!a.published,
    createdAt: a.created_at,
    chain: a.chain,
    slug: a.slug ?? undefined,
    v3AgentId: a.id,
    persona: a.persona ?? undefined,
    price: a.pricing?.x402 ? { amount: a.pricing.x402, currency: 'USDC' } : undefined,
    acceptsPrivate: !!a.pricing?.fherc20,
  };
}

export async function getAgent(id: string | number): Promise<Agent | null> {
  const [brainRes, paidRes] = await Promise.all([
    fetch(`${AGENT_BACKEND_URL}/brains/${id}`),
    fetch(`${AGENT_BACKEND_URL}/v3/agents`).catch(() => null),
  ]);

  // Brain-less fallback: wizard-published agents (PRD-A) have no `brains`
  // row, so `GET /brains/:id` always 404s for them. `GET /v3/agents/:id`
  // resolves the same `id` directly against the `agents` table (no join
  // required for existence), so it's the correct fallback rather than a
  // dead end. discover() only ever surfaces published agents, so this
  // path should always find a live v3AgentId here — never a draft.
  if (!brainRes.ok) {
    const v3Res = await fetch(`${AGENT_BACKEND_URL}/v3/agents/${id}`);
    if (!v3Res.ok) return null;
    const v3Data = (await v3Res.json()) as V3AgentDto;
    return v3AgentToAgent(v3Data);
  }
  const data = (await brainRes.json()) as BrainDto;
  const agent = brainToAgent(data);

  // Same merge as listAgents — keeps the two paths byte-equivalent. See
  // the comment above for why Number() coercion matters (BIGINT vs
  // INTEGER serialization mismatch was the root cause of the persistent
  // "Published in Studio, DRAFT on detail" disagreement).
  if (paidRes && paidRes.ok) {
    try {
      const paid = (await paidRes.json()) as Array<{
        id: string;
        brain_id: number | string;
        slug?: string;
        pricing?: { x402?: string | null; fherc20?: string | null };
        persona?: { system_prompt?: string | null; description?: string };
      }>;
      const target = Number(agent.id);
      const p = paid.find((x) => Number(x.brain_id) === target);
      if (p) {
        agent.slug = p.slug;
        agent.v3AgentId = p.id;
        agent.persona = p.persona;
        if (p.pricing?.x402) agent.price = { amount: p.pricing.x402, currency: 'USDC' };
        if (p.pricing?.fherc20) agent.acceptsPrivate = true;
      }
    } catch {/* leave unenriched */}
  }
  return agent;
}

export async function listMyAgents(walletAddress: string): Promise<Agent[]> {
  const r = await fetch(`${AGENT_BACKEND_URL}/brains/mine`, {
    headers: { 'x-wallet-address': walletAddress },
  });
  if (!r.ok) return [];
  const data = (await r.json()) as BrainDto[];
  return data.map(brainToAgent);
}

export async function createAgent(
  walletAddress: string,
  title: string,
  /**
   * Active chain. When 'sui', sends `x-chain: sui` so the backend skips the
   * EVM-only FHE permit gate and stamps the brain with the Sui chain id.
   * Defaults to EVM behavior so existing callers stay byte-identical (G5).
   */
  chain: 'sui' | 'evm' = 'evm',
): Promise<Agent | null> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-wallet-address': walletAddress,
  };
  if (chain === 'sui') headers['x-chain'] = 'sui';
  const r = await fetch(`${AGENT_BACKEND_URL}/brains/create`, {
    method: 'POST',
    headers,
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

// ─── PRD-21/22 — Studio Hide flow + buyer task history helpers ──────────
//
// Brain-keyed (PRD-22): archiveBrain / restoreBrain operate on a brain id
// and cascade to any agents row wrapping that brain. Works uniformly for
// v1 legacy brains AND v2 marketplace listings — the brain is the user's
// mental model of "an assistant".
//
// Agent-keyed (PRD-21, kept for back-compat): archiveAgent / restoreAgent
// operate on an agent UUID. Used by smoke tests; UI now goes through the
// brain-keyed flow.

export async function archiveBrain(
  brainId: number | string,
  walletAddress: string,
): Promise<{ ok: true; hidden_at: string }> {
  const r = await fetch(
    `${AGENT_BACKEND_URL}/v3/marketplace/seller/brain/${encodeURIComponent(String(brainId))}`,
    { method: 'DELETE', headers: { 'x-wallet-address': walletAddress } },
  );
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { error?: string })?.error ?? `hide failed: ${r.status}`);
  }
  return r.json() as Promise<{ ok: true; hidden_at: string }>;
}

export async function restoreBrain(
  brainId: number | string,
  walletAddress: string,
): Promise<{ ok: true; restored: true }> {
  const r = await fetch(
    `${AGENT_BACKEND_URL}/v3/marketplace/seller/brain/${encodeURIComponent(String(brainId))}/restore`,
    { method: 'POST', headers: { 'x-wallet-address': walletAddress } },
  );
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { error?: string })?.error ?? `restore failed: ${r.status}`);
  }
  return r.json() as Promise<{ ok: true; restored: true }>;
}

/**
 * Soft-archive a single agent (legacy v2 path). Buyer receipts in
 * `paid_calls` are preserved (the agents row stays).
 */
export async function archiveAgent(
  agentId: string,
  walletAddress: string,
): Promise<{ ok: true; archived_at: string }> {
  const r = await fetch(
    `${AGENT_BACKEND_URL}/v3/marketplace/seller/agent/${encodeURIComponent(agentId)}`,
    { method: 'DELETE', headers: { 'x-wallet-address': walletAddress } },
  );
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { error?: string })?.error ?? `archive failed: ${r.status}`);
  }
  return r.json() as Promise<{ ok: true; archived_at: string }>;
}

export async function restoreAgent(
  agentId: string,
  walletAddress: string,
): Promise<{ ok: true; restored: true }> {
  const r = await fetch(
    `${AGENT_BACKEND_URL}/v3/marketplace/seller/agent/${encodeURIComponent(agentId)}/restore`,
    { method: 'POST', headers: { 'x-wallet-address': walletAddress } },
  );
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { error?: string })?.error ?? `restore failed: ${r.status}`);
  }
  return r.json() as Promise<{ ok: true; restored: true }>;
}

/** Bulk-archive every active agent owned by the connected wallet. */
export async function archiveAllMyAgents(
  walletAddress: string,
): Promise<{ ok: true; archived_count: number }> {
  const r = await fetch(`${AGENT_BACKEND_URL}/v3/marketplace/seller/archive-all`, {
    method: 'POST',
    headers: { 'x-wallet-address': walletAddress },
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { error?: string })?.error ?? `archive-all failed: ${r.status}`);
  }
  return r.json() as Promise<{ ok: true; archived_count: number }>;
}

export interface BuyerTask {
  id: number;
  agent_id: string;
  agent_title: string;
  slug: string;
  amount_usdc: string;
  tx_hash: string;
  network: string;
  method: string;
  created_at: string;
}

export interface BuyerTasksResponse {
  tasks: BuyerTask[];
  task_count: number;
  total_spent_usdc: string;
  limit: number;
  offset: number;
}

/** Buyer's full task / receipt history. Auth-derived; never takes a wallet
 *  in the URL (paranoid against URL-leak / wrong-tab-grab). */
export async function listMyTasks(
  walletAddress: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<BuyerTasksResponse> {
  const params = new URLSearchParams();
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.offset) params.set('offset', String(opts.offset));
  const qs = params.toString();
  const r = await fetch(
    `${AGENT_BACKEND_URL}/v3/marketplace/buyer/me/tasks${qs ? `?${qs}` : ''}`,
    { headers: { 'x-wallet-address': walletAddress } },
  );
  if (!r.ok) throw new Error(`tasks fetch failed: ${r.status}`);
  return r.json() as Promise<BuyerTasksResponse>;
}

// ─── PRD-E — workspace uploads + recent-calls feed ─────────────────────────
//
// Used by the new `/agent/[id]/run` workspace and `<AgentRecentCalls />`
// (sidebar on detail + workspace). All shapes mirror the API responses
// 1:1 — the boundary stays explicit.

export interface AgentUploadHandle {
  upload_id: string;
  signed_url: string;
  storage_path: string;
  expires_in_sec: number;
  max_bytes: number;
}

export async function mintAgentUpload(
  v3AgentId: string,
  file: { name: string; type: string; size: number },
  walletAddress?: string,
): Promise<AgentUploadHandle> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (walletAddress) headers['x-wallet-address'] = walletAddress;
  const r = await fetch(
    `${AGENT_BACKEND_URL}/v3/agents/${encodeURIComponent(v3AgentId)}/uploads`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        original_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        size_bytes: file.size,
        ...(walletAddress ? { uploader_addr: walletAddress } : {}),
      }),
    },
  );
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { error?: string })?.error ?? `upload mint failed: ${r.status}`);
  }
  return r.json() as Promise<AgentUploadHandle>;
}

/**
 * One-shot helper: mint signed URL + PUT the file. Returns the upload_id
 * the workspace then attaches to /try or the paid x402 call.
 */
export async function uploadFileToAgent(
  v3AgentId: string,
  file: File,
  walletAddress?: string,
): Promise<string> {
  const handle = await mintAgentUpload(
    v3AgentId,
    { name: file.name, type: file.type, size: file.size },
    walletAddress,
  );
  const put = await fetch(handle.signed_url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!put.ok) throw new Error(`upload PUT failed: ${put.status}`);
  return handle.upload_id;
}

export interface AgentRecentCall {
  tx_hash: string;
  payer: string;          // already anonymized on the server (e.g. 0xab12…cd34)
  amount_usdc: string;
  status: 'success' | 'demo' | 'free';
  network: string;
  settled_at: string;     // ISO timestamp
}

export async function getAgentRecentCalls(
  v3AgentId: string,
  limit = 10,
): Promise<AgentRecentCall[]> {
  const r = await fetch(
    `${AGENT_BACKEND_URL}/v3/agents/${encodeURIComponent(v3AgentId)}/recent-calls?limit=${limit}`,
  );
  if (!r.ok) return [];
  const data = (await r.json()) as { rows?: AgentRecentCall[] };
  return Array.isArray(data.rows) ? data.rows : [];
}
