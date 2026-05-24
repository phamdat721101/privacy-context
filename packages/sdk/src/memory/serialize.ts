/**
 * Memory entity serializer — single source of truth for the Arkiv on-wire schema.
 *
 * Why one file: SOLID-SRP at the *module* level. types.ts owns shapes; this
 * file owns the (de)serialization for those shapes. Callers (server, scripts,
 * frontend) only depend on these two files plus the Arkiv SDK.
 *
 * Pipeline:
 *   write side:  build LearnedFact → sign canonical body → optional AES-GCM
 *                envelope → emit { payload, contentType, attributes, expiresIn }
 *   read side:   { payload, attributes } → optional AES-GCM decrypt → parse
 *                JSON → recover signer → return LearnedFact
 *
 * Signature scheme: EIP-191 personal_sign over canonical-JSON of
 *   { confidence, derivedAt, fact, signer, source }   (keys sorted)
 * which is what `viem.signMessage`/`recoverMessageAddress` natively round-trip.
 */

import { recoverMessageAddress, type Hex } from 'viem';
import { encryptContentWithKey, decryptContent } from '../brain/encryption';
import {
  type LearnedFact,
  type MemoryAttributes,
  type MemoryEntityInput,
  type SerializeOpts,
  MemorySchemaError,
} from './types';

// ─── Constants (single source of truth — don't duplicate elsewhere) ─────────

/** Default project attribute. Override per-call via `opts.project`. */
export const DEFAULT_PROJECT_ATTRIBUTE = 'fhedin-ethns-2c4f9a';

/** Default 30-day TTL. */
export const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;

/** Mime type when payload is an AES-GCM envelope. */
const CONTENT_TYPE_PLAINTEXT = 'application/json';
const CONTENT_TYPE_CIPHERTEXT = 'application/octet-stream';

// ─── Canonical JSON (deterministic, sorted keys) ────────────────────────────

/** Recursive deterministic stringifier. Used for signing + verification. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

/** The exact bytes a Memory-Agent signs. Same on write and read. Generic over
 *  any "signed entity" shape — works for LearnedFact, AgentDecision, and any
 *  future signed type that carries a `signer: Hex` field.
 *
 *  Strips `signature` if the caller passed a fully-signed object — verification
 *  receives the signed object back from the wire and must reconstruct the EXACT
 *  same canonical body the sender signed (which excluded the signature itself). */
export function buildSigningMessage<T extends { signer: import('viem').Hex }>(unsigned: T): string {
  const { signature: _drop, ...body } = unsigned as { signature?: unknown } & T;
  return canonicalize({ ...body, signer: (body.signer as string).toLowerCase() });
}

// ─── Write side ─────────────────────────────────────────────────────────────

/** Convert a signed LearnedFact into the exact input `walletClient.createEntity` expects. */
export function toEntityInput(fact: LearnedFact, opts: SerializeOpts): MemoryEntityInput {
  if (!fact.signature || !fact.signer) {
    throw new MemorySchemaError('LearnedFact must be signed before serialization', 'INVALID_SIGNATURE');
  }

  const json = JSON.stringify(fact);
  const isConfidential = !!opts.aesKey;

  let payload: Uint8Array;
  let contentType: string;
  if (isConfidential) {
    const encrypted = encryptContentWithKey(json, opts.aesKey!).encrypted;
    payload = new Uint8Array(encrypted);
    contentType = CONTENT_TYPE_CIPHERTEXT;
  } else {
    payload = new TextEncoder().encode(json);
    contentType = CONTENT_TYPE_PLAINTEXT;
  }

  const attributes: MemoryAttributes = {
    project: opts.project,
    entityType: 'agent-memory',
    memoryType: 'learned-fact',
    agentId: fact.signer.toLowerCase() as Hex,
    topic: opts.topic,
    confidence: clampInt(fact.confidence, 0, 100),
    sourceBrain: fact.source.brainId,
    createdAt: fact.derivedAt,
    confidential: isConfidential ? 1 : 0,
  };

  return {
    payload,
    contentType,
    attributes: attributesToArkiv(attributes),
    expiresIn: opts.expiresInSeconds ?? DEFAULT_TTL_SECONDS,
  };
}

// ─── Read side ──────────────────────────────────────────────────────────────

/**
 * Parse an Arkiv entity back into a LearnedFact, verifying the signature.
 * Throws `MemorySchemaError` if confidential & no key provided, or if the
 * signature doesn't recover to the declared signer.
 */
export async function fromEntity(
  entity: { payload: Uint8Array; attributes: ReadonlyArray<{ key: string; value: string | number }> },
  opts: { aesKey?: Buffer } = {},
): Promise<LearnedFact> {
  const attrs = attributesFromArkiv(entity.attributes);
  let json: string;

  if (attrs.confidential === 1) {
    if (!opts.aesKey) {
      throw new MemorySchemaError('Memory entity is confidential — caller must provide aesKey', 'CONFIDENTIAL_NEEDS_KEY');
    }
    json = decryptContent(Buffer.from(entity.payload), opts.aesKey);
  } else {
    json = new TextDecoder().decode(entity.payload);
  }

  let fact: LearnedFact;
  try {
    fact = JSON.parse(json) as LearnedFact;
  } catch {
    throw new MemorySchemaError('payload is not valid JSON', 'BAD_PAYLOAD');
  }

  // Verify the signature (signer-recovery; immutable provenance even if attrs lie).
  const message = buildSigningMessage(fact);
  const recovered = await recoverMessageAddress({ message, signature: fact.signature });
  if (recovered.toLowerCase() !== fact.signer.toLowerCase()) {
    throw new MemorySchemaError(`signature does not match signer (recovered=${recovered})`, 'INVALID_SIGNATURE');
  }
  return fact;
}

// ─── Attribute pack/unpack (Arkiv's flat key/value array shape) ─────────────

/** Convert the strongly-typed MemoryAttributes object into Arkiv's array form. */
export function attributesToArkiv(a: MemoryAttributes): Array<{ key: string; value: string | number }> {
  return [
    { key: 'project', value: a.project },
    { key: 'entityType', value: a.entityType },
    { key: 'memoryType', value: a.memoryType },
    { key: 'agentId', value: a.agentId },
    { key: 'topic', value: a.topic },
    { key: 'confidence', value: a.confidence },
    { key: 'sourceBrain', value: a.sourceBrain },
    { key: 'createdAt', value: a.createdAt },
    { key: 'confidential', value: a.confidential },
  ];
}

/** Inverse — strict parser that throws if attributes are malformed. */
export function attributesFromArkiv(
  arr: ReadonlyArray<{ key: string; value: string | number }>,
): MemoryAttributes {
  const map = new Map(arr.map((a) => [a.key, a.value]));
  const need = (k: string): string | number => {
    const v = map.get(k);
    if (v === undefined) throw new MemorySchemaError(`missing attribute "${k}"`, 'BAD_ATTRIBUTES');
    return v;
  };
  return {
    project: String(need('project')),
    entityType: 'agent-memory',
    memoryType: 'learned-fact',
    agentId: String(need('agentId')).toLowerCase() as Hex,
    topic: String(need('topic')),
    confidence: Number(need('confidence')),
    sourceBrain: Number(need('sourceBrain')),
    createdAt: Number(need('createdAt')),
    confidential: (Number(need('confidential')) === 1 ? 1 : 0) as 0 | 1,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function clampInt(n: number, lo: number, hi: number): number {
  const x = Math.round(Number(n));
  return Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : lo));
}

// ─── AgentDecision (2nd entity type) ────────────────────────────────────────

/** Default 7-day TTL — shorter than memories (30d). Differentiated expiration
 *  per the builders-guide: "the strongest signals you understand Arkiv". */
export const DEFAULT_DECISION_TTL_SECONDS = 60 * 60 * 24 * 7;

/** Convert a signed AgentDecision into walletClient.createEntity input.
 *  Decisions are inherently public reputation signals — never AES-enveloped. */
export function decisionToEntityInput(
  decision: import('./types').AgentDecision,
  opts: SerializeOpts,
): MemoryEntityInput {
  if (!decision.signature || !decision.signer) {
    throw new MemorySchemaError('AgentDecision must be signed before serialization', 'INVALID_SIGNATURE');
  }
  return {
    payload: new TextEncoder().encode(JSON.stringify(decision)),
    contentType: CONTENT_TYPE_PLAINTEXT,
    attributes: [
      { key: 'project', value: opts.project },
      { key: 'entityType', value: 'agent-decision' },
      { key: 'agentId', value: decision.signer.toLowerCase() },
      { key: 'topic', value: opts.topic },
      { key: 'decision', value: decision.decision },
      { key: 'priorFactCount', value: clampInt(decision.priorFactCount, 0, 1_000_000) },
      { key: 'createdAt', value: decision.chosenAt },
    ],
    expiresIn: opts.expiresInSeconds ?? DEFAULT_DECISION_TTL_SECONDS,
  };
}

/** Parse + verify an Arkiv entity → AgentDecision. Mirrors fromEntity but
 *  decisions are always plaintext, so no AES branch. */
export async function decisionFromEntity(
  entity: { payload: Uint8Array; attributes: ReadonlyArray<{ key: string; value: string | number }> },
): Promise<import('./types').AgentDecision> {
  let json: string;
  try {
    json = new TextDecoder().decode(entity.payload);
  } catch {
    throw new MemorySchemaError('AgentDecision payload not decodable', 'BAD_PAYLOAD');
  }
  let decision: import('./types').AgentDecision;
  try {
    decision = JSON.parse(json) as import('./types').AgentDecision;
  } catch {
    throw new MemorySchemaError('AgentDecision payload not valid JSON', 'BAD_PAYLOAD');
  }
  // Same signature-recovery path as LearnedFact — single source of truth for provenance.
  const message = buildSigningMessage({
    chosenAt: decision.chosenAt,
    decision: decision.decision,
    priorFactCount: decision.priorFactCount,
    signer: decision.signer,
    topic: decision.topic,
  });
  const recovered = await recoverMessageAddress({ message, signature: decision.signature });
  if (recovered.toLowerCase() !== decision.signer.toLowerCase()) {
    throw new MemorySchemaError(`signature does not match signer (recovered=${recovered})`, 'INVALID_SIGNATURE');
  }
  return decision;
}
