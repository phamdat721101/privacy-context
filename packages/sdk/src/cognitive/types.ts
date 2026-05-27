/**
 * Cognitive Memory v1 — type contracts (no runtime besides sign/verify helpers).
 *
 * Three layers, one file (SOLID-SRP at the module level): types.ts owns
 * shapes + the lightweight sign/verify glue; keyWrap.ts owns key derivation;
 * consolidator.ts owns the L1→L2→L3 promotion logic.
 *
 * Re-uses `buildSigningMessage` from memory/serialize so we never duplicate the
 * canonical-JSON convention across modules. One signing pattern across the
 * whole codebase.
 */

import { recoverMessageAddress, type Hex } from 'viem';
import { buildSigningMessage } from '../memory/serialize';

// ─── TTLs (single source of truth) ──────────────────────────────────────────

export const L1_TTL_SEC = 60 * 60 * 24 * 7;
export const L2_TTL_SEC = 60 * 60 * 24 * 30;
export const L3_TTL_SEC = 60 * 60 * 24 * 90;

// ─── Layer key ──────────────────────────────────────────────────────────────

export const COGNITIVE_LAYERS = ['L1', 'L2', 'L3'] as const;
export type CognitiveLayer = typeof COGNITIVE_LAYERS[number];

// ─── L1 Episode ─────────────────────────────────────────────────────────────

/** L1 episode — one paid agent interaction. Plaintext shape (encrypted at rest). */
export interface Episode {
  /** Free-text body — chat turn, tool call, or decision summary. */
  body: string;
  /** Topic hash (16-hex), matches the format used by Arkiv-side memories. */
  topic: string;
  /** Address of the agent that triggered this episode. */
  agentId: Hex;
  /** Brain id this episode is associated with. */
  brainId: number;
  /** Session id — groups consecutive turns of the same conversation. */
  sessionId: string;
  /** Unix ms. */
  createdAt: number;
}

// ─── L2 SemanticFact ────────────────────────────────────────────────────────

export const FACT_TYPES = ['fact', 'preference', 'relation', 'profile', 'event'] as const;
export type FactType = typeof FACT_TYPES[number];

/** L2 fact — atomic claim derived from ≥3 corroborating L1 episodes. */
export interface SemanticFact {
  fact: string;
  factType: FactType;
  topic: string;
  /** 0..100. */
  confidence: number;
  /** L1 episode ids this fact was derived from (≥3). */
  derivedFrom: string[];
  /** Optional grouping key for the L3 promoter. */
  procedureKey?: string;
  /** Brain owner wallet. */
  signer: Hex;
  /** EIP-191 signature over canonicalize(body without signature). */
  signature: Hex;
  /** Unix ms. */
  derivedAt: number;
}

// ─── L3 ProceduralBundle ────────────────────────────────────────────────────

export interface CognitiveBundleStep {
  name: string;
  description: string;
}

/** L3 bundle — runnable, signed, encrypted manifest. Phala TEE executes it. */
export interface ProceduralBundle {
  procedureKey: string;
  manifest: {
    steps: CognitiveBundleStep[];
    /** JSON-Schema-like shape — public so buyers know what to send. */
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
  };
  /** L2 fact ids that justified the promotion (≥5). */
  derivedFrom: string[];
  /** USDC string, e.g. "0.05". Phase 2 monetization hook. */
  defaultPriceUsdc: string;
  signer: Hex;
  signature: Hex;
  createdAt: number;
}

// ─── Sign / verify (reuse memory/serialize.canonicalize via buildSigningMessage) ─

/** Errors thrown by sign/verify — typed for caller pattern-matching. */
export class CognitiveSchemaError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_SIGNATURE' | 'BAD_PAYLOAD',
  ) {
    super(message);
    this.name = 'CognitiveSchemaError';
  }
}

/**
 * Build the canonical signing message for a SemanticFact. Strips signature
 * field so write-side and read-side reconstruct the exact same bytes.
 */
export function factSigningMessage(fact: Omit<SemanticFact, 'signature'> & { signature?: Hex }): string {
  return buildSigningMessage(fact as { signer: Hex });
}

/** Verify a SemanticFact's signature against its declared signer. */
export async function verifyFact(fact: SemanticFact): Promise<boolean> {
  try {
    const msg = factSigningMessage(fact);
    const recovered = await recoverMessageAddress({ message: msg, signature: fact.signature });
    return recovered.toLowerCase() === fact.signer.toLowerCase();
  } catch {
    return false;
  }
}

/** Build the canonical signing message for a ProceduralBundle. */
export function bundleSigningMessage(b: Omit<ProceduralBundle, 'signature'> & { signature?: Hex }): string {
  return buildSigningMessage(b as { signer: Hex });
}

/** Verify a ProceduralBundle's signature against its declared signer. */
export async function verifyBundle(b: ProceduralBundle): Promise<boolean> {
  try {
    const msg = bundleSigningMessage(b);
    const recovered = await recoverMessageAddress({ message: msg, signature: b.signature });
    return recovered.toLowerCase() === b.signer.toLowerCase();
  } catch {
    return false;
  }
}
