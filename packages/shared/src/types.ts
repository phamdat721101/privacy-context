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
