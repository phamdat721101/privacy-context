/**
 * arkivMemoryService — Server-side handle to the Arkiv Memory tier.
 *
 * SOLID:
 * - SRP: this module owns Arkiv I/O for `agent-memory` entities. Nothing else.
 * - DIP: route handlers depend on this service interface, not on @arkiv-network/sdk.
 * - OCP: new memory types (RAG cache, working trace) extend the SDK's
 *   `serialize` module, not this service.
 *
 * Reliability: every Arkiv RPC call is wrapped in `resilientCall` so a flaky
 * Braga RPC does not crash the api process (per project convention in
 * docs/PROJECT_CONTEXT.md > "Resilient I/O").
 *
 * Boot safety: clients are lazy. If ARKIV_BACKEND_PRIVATE_KEY is missing the
 * api still boots (v2/v3 paths unaffected); only /v4 calls fail with a clear
 * 503.
 */

import { createWalletClient, createPublicClient, http, type Hex } from '@arkiv-network/sdk';
import { privateKeyToAccount } from '@arkiv-network/sdk/accounts';
import { braga } from '@arkiv-network/sdk/chains';
import { eq, gt, desc } from '@arkiv-network/sdk/query';
import {
  toEntityInput,
  fromEntity,
  decisionToEntityInput,
  decisionFromEntity,
  DEFAULT_TTL_SECONDS,
  DEFAULT_DECISION_TTL_SECONDS,
  type LearnedFact,
  type AgentDecision,
  type MemoryEntityInput,
} from '@fhe-ai-context/sdk';
import { logger, resilientCall } from '../lib';

// ─── Lazy singletons ────────────────────────────────────────────────────────

let _wallet: any = null;
let _public: any = null;

function backendAddress(): Hex {
  const a = (process.env.ARKIV_BACKEND_WALLET ?? '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(a)) {
    throw Object.assign(new Error('ARKIV_BACKEND_WALLET missing or invalid'), { status: 503 });
  }
  return a as Hex;
}

function projectAttribute(): string {
  return process.env.ARKIV_PROJECT_ATTRIBUTE ?? 'fhedin-ethns-2c4f9a';
}

function getWallet() {
  if (_wallet) return _wallet;
  const pk = process.env.ARKIV_BACKEND_PRIVATE_KEY as `0x${string}` | undefined;
  if (!pk) throw Object.assign(new Error('ARKIV_BACKEND_PRIVATE_KEY missing'), { status: 503 });
  // Cast to any: api & sdk bundle different viem versions; runtime is compatible.
  _wallet = (createWalletClient as any)({ chain: braga, transport: http(process.env.ARKIV_RPC_URL), account: privateKeyToAccount(pk) });
  return _wallet;
}

function getPublic() {
  if (_public) return _public;
  _public = (createPublicClient as any)({ chain: braga, transport: http(process.env.ARKIV_RPC_URL) });
  return _public;
}

const RESILIENT = { name: 'arkiv', maxRetries: 2, breaker: 'arkiv' as const };

// ─── Public service surface ─────────────────────────────────────────────────

export interface MemoryReadOpts {
  /** Memory-Agent wallet to filter by. */
  agentId: Hex;
  /** Hex topic hash (16 chars) — see serialize.canonicalize for format. */
  topic?: string;
  minConfidence?: number;
  limit?: number;
  cursor?: string;
}

/**
 * writeLearned — server-side write of a *signed* LearnedFact.
 *
 * Caller is responsible for signing (the Memory-Agent's wallet, off-band).
 * This service only relays gas + injects the project attribute.
 */
export async function writeLearned(
  fact: LearnedFact,
  topic: string,
  expiresInSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<{ entityKey: string; txHash: string }> {
  const input = toEntityInput(fact, { project: projectAttribute(), topic, expiresInSeconds });
  return writeAttributedEntity(input, { agentId: fact.signer, entityType: 'agent-memory', topic });
}

/**
 * writeDecision — server-side write of a *signed* AgentDecision (2nd entity type).
 *
 * Symmetric shape to writeLearned. Decisions are always plaintext (public
 * reputation log per the AI theme of the builders-guide).
 */
export async function writeDecision(
  decision: AgentDecision,
  topic: string,
  expiresInSeconds: number = DEFAULT_DECISION_TTL_SECONDS,
): Promise<{ entityKey: string; txHash: string }> {
  const input = decisionToEntityInput(decision, { project: projectAttribute(), topic, expiresInSeconds });
  return writeAttributedEntity(input, { agentId: decision.signer, entityType: 'agent-decision', topic });
}

/**
 * Private — single source of truth for "write a typed Arkiv entity".
 * SOLID-OCP: a third type later (attestation, skill, …) is one new public
 * function calling this; no edits here.
 */
async function writeAttributedEntity(
  input: MemoryEntityInput,
  ctx: { agentId: Hex; entityType: string; topic: string },
): Promise<{ entityKey: string; txHash: string }> {
  const wallet = getWallet();
  const result = await resilientCall(RESILIENT, async () =>
    wallet.createEntity({
      payload: input.payload,
      contentType: input.contentType,
      attributes: input.attributes,
      expiresIn: input.expiresIn,
    }),
  );
  logger.info(
    { entityKey: result.entityKey, txHash: result.txHash, ...ctx },
    `arkiv:${ctx.entityType}:write`,
  );
  return { entityKey: result.entityKey, txHash: result.txHash };
}

/**
 * findRelevant — query memories matching a topic for an agent, filtered to
 * entities created by *our* backend wallet (Best Practice #12: tamper-proof
 * source even if attributes are spoofed).
 */
export async function findRelevant(opts: MemoryReadOpts): Promise<{ facts: LearnedFact[]; entityKeys: string[] }> {
  const reader = getPublic();
  const wheres = [eq('project', projectAttribute()), eq('entityType', 'agent-memory'), eq('agentId', opts.agentId.toLowerCase())];
  if (opts.topic) wheres.push(eq('topic', opts.topic));
  if (typeof opts.minConfidence === 'number') wheres.push(gt('confidence', opts.minConfidence));

  const result = await resilientCall(RESILIENT, async () =>
    reader
      .buildQuery()
      .where(wheres)
      .createdBy(backendAddress())
      .orderBy(desc('createdAt', 'number'))
      .withPayload(true)
      .withAttributes(true)
      .limit(Math.min(opts.limit ?? 10, 100))
      .fetch(),
  );

  const facts: LearnedFact[] = [];
  const entityKeys: string[] = [];
  for (const e of result.entities) {
    try {
      const fact = await fromEntity({ payload: e.payload, attributes: e.attributes });
      facts.push(fact);
      entityKeys.push(e.key);
    } catch (err) {
      // Skip entities that fail signature verification — never crash the read path.
      logger.warn({ entityKey: e.key, err: (err as Error).message }, 'arkiv:memory:bad-entity');
    }
  }
  return { facts, entityKeys };
}

/**
 * listByAgent — paginated raw view (used by the frontend live feed). Returns
 * minimal entity metadata; payload-decode happens client-side per card.
 */
export async function listByAgent(
  agentId: Hex,
  cursor?: string,
  limit = 20,
): Promise<{ items: Array<{ entityKey: string; attributes: Record<string, string | number>; payloadB64: string }>; nextCursor: string | null }> {
  const reader = getPublic();
  const result = await resilientCall(RESILIENT, async () =>
    reader
      .buildQuery()
      .where([eq('project', projectAttribute()), eq('entityType', 'agent-memory'), eq('agentId', agentId.toLowerCase())])
      .createdBy(backendAddress())
      .orderBy(desc('createdAt', 'number'))
      .withPayload(true)
      .withAttributes(true)
      .limit(Math.min(limit, 200))
      .fetch(),
  );
  const items = result.entities.map((e) => ({
    entityKey: e.key,
    attributes: Object.fromEntries(e.attributes.map((a: { key: string; value: string | number }) => [a.key, a.value])),
    payloadB64: Buffer.from(e.payload).toString('base64'),
  }));
  // Note: Arkiv's cursor pagination — nextCursor surfacing if SDK supports it.
  const nextCursor = (result as unknown as { hasNextPage?: () => boolean; cursor?: string }).hasNextPage?.()
    ? ((result as unknown as { cursor?: string }).cursor ?? null)
    : null;
  return { items, nextCursor };
}

/** getOne — fetch a single entity (public). */
export async function getOne(entityKey: string): Promise<{ entityKey: string; attributes: Record<string, string | number>; payloadB64: string }> {
  const reader = getPublic();
  const e = await resilientCall(RESILIENT, async () => reader.getEntity(entityKey as Hex));
  return {
    entityKey,
    attributes: Object.fromEntries(((e as { attributes?: { key: string; value: string | number }[] }).attributes ?? []).map((a) => [a.key, a.value])),
    payloadB64: Buffer.from((e as { payload: Uint8Array }).payload).toString('base64'),
  };
}

/** extend — bump a memory entity's TTL. Caller (route) is responsible for paywall. */
export async function extend(entityKey: string, extraSeconds: number): Promise<{ txHash: string }> {
  const wallet = getWallet();
  const r = await resilientCall(RESILIENT, async () => wallet.extendEntity({ entityKey: entityKey as Hex, expiresIn: extraSeconds }));
  logger.info({ entityKey, extraSeconds, txHash: r.txHash }, 'arkiv:memory:extend');
  return { txHash: r.txHash };
}

/** Diagnostics — used by /v4/version and tests. */
export function arkivConfigSummary() {
  return {
    rpc: process.env.ARKIV_RPC_URL ?? null,
    project: projectAttribute(),
    backendWallet: process.env.ARKIV_BACKEND_WALLET ?? null,
    ready: !!process.env.ARKIV_BACKEND_PRIVATE_KEY && !!process.env.ARKIV_BACKEND_WALLET,
  };
}

// ─── Sovereign-tier reads (entities owned by an arbitrary user wallet) ──────

export interface OwnerReadOpts {
  /** The user wallet that owns the entities (== signer of createEntity). */
  ownedBy: Hex;
  topic?: string;
  minConfidence?: number;
  limit?: number;
}

/**
 * Topic-filtered query restricted to entities a specific user wallet owns.
 * Used by /v4/chat-with-memory to assemble the user's own context. Skips
 * the createdBy filter intentionally — for sovereign-tier writes the user
 * is both creator and owner, so ownedBy alone is sufficient and forward-
 * compatible with future ownership transfers.
 */
export async function findByOwner(opts: OwnerReadOpts): Promise<{ facts: LearnedFact[]; entityKeys: string[] }> {
  const reader = getPublic();
  const wheres = [eq('project', projectAttribute()), eq('entityType', 'agent-memory')];
  if (opts.topic) wheres.push(eq('topic', opts.topic));
  if (typeof opts.minConfidence === 'number') wheres.push(gt('confidence', opts.minConfidence));

  const result = await resilientCall(RESILIENT, async () =>
    reader
      .buildQuery()
      .where(wheres)
      .ownedBy(opts.ownedBy.toLowerCase() as Hex)
      .orderBy(desc('createdAt', 'number'))
      .withPayload(true)
      .withAttributes(true)
      .limit(Math.min(opts.limit ?? 10, 100))
      .fetch(),
  );

  const facts: LearnedFact[] = [];
  const entityKeys: string[] = [];
  for (const e of result.entities) {
    try {
      const fact = await fromEntity({ payload: e.payload, attributes: e.attributes });
      facts.push(fact);
      entityKeys.push(e.key);
    } catch (err) {
      logger.warn({ entityKey: e.key, err: (err as Error).message }, 'arkiv:memory:bad-entity');
    }
  }
  return { facts, entityKeys };
}

// ─── AgentDecision read paths (2nd entity type) ─────────────────────────────

export interface DecisionReadOpts {
  agentId: Hex;
  topic?: string;
  decision?: 'use-prior' | 'query-brain';
  limit?: number;
}

/** Topic-filtered decisions for an agent, signature-verified, createdBy-gated. */
export async function findDecisions(opts: DecisionReadOpts): Promise<{ decisions: AgentDecision[]; entityKeys: string[] }> {
  const reader = getPublic();
  const wheres = [
    eq('project', projectAttribute()),
    eq('entityType', 'agent-decision'),
    eq('agentId', opts.agentId.toLowerCase()),
  ];
  if (opts.topic) wheres.push(eq('topic', opts.topic));
  if (opts.decision) wheres.push(eq('decision', opts.decision));

  const result = await resilientCall(RESILIENT, async () =>
    reader
      .buildQuery()
      .where(wheres)
      .createdBy(backendAddress())
      .orderBy(desc('createdAt', 'number'))
      .withPayload(true)
      .withAttributes(true)
      .limit(Math.min(opts.limit ?? 10, 100))
      .fetch(),
  );

  const decisions: AgentDecision[] = [];
  const entityKeys: string[] = [];
  for (const e of result.entities) {
    try {
      const d = await decisionFromEntity({ payload: e.payload, attributes: e.attributes });
      decisions.push(d);
      entityKeys.push(e.key);
    } catch (err) {
      logger.warn({ entityKey: e.key, err: (err as Error).message }, 'arkiv:decision:bad-entity');
    }
  }
  return { decisions, entityKeys };
}

/** Paginated raw view (frontend "Recent decisions" strip). */
export async function listDecisionsByAgent(
  agentId: Hex,
  limit = 20,
): Promise<{ items: Array<{ entityKey: string; attributes: Record<string, string | number> }> }> {
  const reader = getPublic();
  const result = await resilientCall(RESILIENT, async () =>
    reader
      .buildQuery()
      .where([eq('project', projectAttribute()), eq('entityType', 'agent-decision'), eq('agentId', agentId.toLowerCase())])
      .createdBy(backendAddress())
      .orderBy(desc('createdAt', 'number'))
      .withAttributes(true)
      .limit(Math.min(limit, 200))
      .fetch(),
  );
  const items = result.entities.map((e: any) => ({
    entityKey: e.key,
    attributes: Object.fromEntries(
      (e.attributes ?? []).map((a: { key: string; value: string | number }) => [a.key, a.value]),
    ),
  }));
  return { items };
}
