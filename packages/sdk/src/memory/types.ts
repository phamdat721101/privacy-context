/**
 * Memory layer — type contracts (no runtime).
 *
 * SOLID:
 * - SRP: this file declares schemas only.
 * - OCP: callers depend on `LearnedFact` and `MemoryAttributes`; new memory
 *   types (e.g. RAG cache, working trace) extend these unions without rewrites.
 * - DIP: server + frontend + scripts all import from here, never from each other.
 */

import type { Hex } from 'viem';

/** A single signed claim a Memory-Agent makes about something it learned. */
export interface LearnedFact {
  /** Plain-text fact in the agent's voice. */
  fact: string;
  /** Provenance — which brain/query produced this. */
  source: {
    brainId: number;
    queryHash: string;
    chunkHashes?: string[];
  };
  /** 0..100 — queryable as numeric attribute via `gt`/`lt`. */
  confidence: number;
  /** Unix ms — queryable as numeric attribute via `orderBy(desc('createdAt'))`. */
  derivedAt: number;
  /** Memory-Agent wallet address (must match the recovered signer). */
  signer: Hex;
  /** EIP-191 signature of canonicalize({fact, source, confidence, derivedAt, signer}). */
  signature: Hex;
}

/** Discoverable, queryable attributes — always plaintext, even when payload is AES. */
export interface MemoryAttributes {
  /** Best Practice #1 — every entity carries this. */
  project: string;
  entityType: 'agent-memory';
  memoryType: 'learned-fact';
  /** Memory-Agent wallet (lowercased). */
  agentId: Hex;
  /** Hex(keccak256(topic)).slice(0,16). */
  topic: string;
  /** 0..100 numeric — supports range queries. */
  confidence: number;
  /** Brain id this memory was derived from — numeric for joins. */
  sourceBrain: number;
  /** Unix ms — numeric for `orderBy`. */
  createdAt: number;
  /** 0 = plaintext payload, 1 = AES-256-GCM envelope (key off-band). */
  confidential: 0 | 1;
}

/** Result of `serialize.toEntityInput(fact, opts)` — fed straight to `walletClient.createEntity`. */
export interface MemoryEntityInput {
  payload: Uint8Array;
  contentType: string;
  attributes: Array<{ key: string; value: string | number }>;
  expiresIn: number;
}

/** Options for serialization. Either `signWith` (offline canonical sign) is set, OR `fact.signature` already populated. */
export interface SerializeOpts {
  /** Project-attribute value injected at write time. */
  project: string;
  /** Topic hash already computed by caller (16 hex chars). */
  topic: string;
  /** TTL in seconds — defaults to 30 days. */
  expiresInSeconds?: number;
  /** When set, payload is AES-GCM encrypted with this 32-byte key. */
  aesKey?: Buffer;
}

/** Errors thrown by serialize/parse — typed for caller pattern-matching. */
export class MemorySchemaError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_SIGNATURE' | 'CONFIDENTIAL_NEEDS_KEY' | 'BAD_ATTRIBUTES' | 'BAD_PAYLOAD',
  ) {
    super(message);
    this.name = 'MemorySchemaError';
  }
}

// ─── AgentDecision (2nd entity type — AI-theme reputation log) ─────────────

/**
 * A signed verdict the Memory-Agent makes per cycle: did it reuse prior memory
 * or query the brain afresh? Public + tamper-proof on Arkiv via `$creator`
 * (immutable backend wallet) and signature recovery (proves the agent itself
 * authored the verdict).
 *
 * Linked to LearnedFacts via the shared `agentId` + `topic` attributes —
 * the guide's "relationships are shared attribute keys" pattern.
 */
export interface AgentDecision {
  /** Verdict — closed enum so attribute equality queries are exhaustive. */
  decision: 'use-prior' | 'query-brain';
  /** Same topic hash as memories → enables joining decisions to outcomes. */
  topic: string;
  /** Numeric → supports `gt`/`lt` for cohort analysis ("decisions made with ≥3 priors"). */
  priorFactCount: number;
  /** Unix ms → orderBy desc for the reputation timeline. */
  chosenAt: number;
  /** Memory-Agent wallet (must equal recovered signer). */
  signer: import('viem').Hex;
  /** EIP-191 signature of canonicalize(body without signature). */
  signature: import('viem').Hex;
}
