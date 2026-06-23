// packages/shared/src/types.ts
//
// PRD-F: FHE strip — post-cutover shared types.
// `Chain` widened to a plain string for forward-compat; `Rail` narrowed to
// the two rails we still ship; the legacy `Brain.chain`/`AgentRecord.chain`
// readers continue to compile because they consumed `string` underneath.

export enum SubscriptionTier {
  WEEK = 1,
  MONTH = 2,
  QUARTER = 3,
}

export const TIER_PRICING: Record<SubscriptionTier, bigint> = {
  [SubscriptionTier.WEEK]: 5_000000n,
  [SubscriptionTier.MONTH]: 15_000000n,
  [SubscriptionTier.QUARTER]: 35_000000n,
};

export interface Brain {
  id: number;
  owner_address: string;
  title: string;
  description: string;
  tags: string[];
  ipfs_cid: string | null;
  chain: string;
  published: boolean;
  created_at: Date;
}

export interface KnowledgeChunk {
  id: number;
  brain_id: number;
  chunk_index: number;
  content: string;
  ipfs_cid: string | null;
  created_at: Date;
}

export interface Subscription {
  id: number;
  user_address: string;
  tier: SubscriptionTier;
  chain: string;
  tx_hash: string;
  expires_at: Date;
  created_at: Date;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface ChatHistory {
  id: number;
  user_address: string;
  brain_id: number;
  messages: ChatMessage[];
  summary: string | null;
  summary_cid: string | null;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// v3 — Agentic marketplace
// ---------------------------------------------------------------------------

/** EVM chain identifier. After PRD-F strip: 'arbitrum-sepolia' | 'base-sepolia'. */
export type Chain = string;

/** Payment rails. 'fherc20' + 'sui_usdc' removed in PRD-F. */
export type Rail = 'x402' | 'mpp';

export interface AgentPersona {
  system_prompt: string;
  tools: string[];
  model: string;
}

/** Pricing per rail. `null` means rail disabled for this agent. */
export interface AgentPricing {
  x402: string | null;
  mpp: string | null;
}

export interface AgentRecord {
  id: string;
  brain_id: number;
  owner_address: string;
  chain: Chain;
  persona: AgentPersona;
  pricing: AgentPricing;
  kya_required: boolean;
  min_reputation: number;
  published: boolean;
  created_at: Date;
}

export interface AgentLink {
  canonical_id: string;
  eth_address: string | null;
  eth_sig: string | null;
  reputation: number;
  created_at: Date;
}

export interface MppSession {
  id: string;
  agent_id: string;
  buyer: string;
  deposit_usdc: string;
  consumed_usdc: string;
  voucher_log: Array<{ amount: string; ts: number; sig: string }>;
  status: 'open' | 'settling' | 'closed';
  opened_at: Date;
  closed_at: Date | null;
}

export interface BundleStep {
  agent_id: string;
  endpoint: string;
  rail: Rail;
  price_usdc: string;
  estimated_calls: number;
  description?: string;
}

export interface BundleManifestBody {
  id: string;
  issuer: string;
  steps: BundleStep[];
  aggregate_price_usdc: string;
  expires_at: number;
  metadata?: Record<string, unknown>;
}

export interface BundleManifest extends BundleManifestBody {
  signature: string;
}

export interface AgentReceipt {
  id: number;
  agent_id: string;
  buyer: string;
  rail: Rail;
  amount_usdc: string;
  tx_or_receipt: string;
  bundle_id: string | null;
  created_at: Date;
}
