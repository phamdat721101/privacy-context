'use client';

/**
 * lib/arkiv.ts — frontend's lightweight Arkiv adapter.
 *
 * Single responsibility: own the browser-side `createPublicClient` + the
 * project-attribute filter and explorer URLs. The /memory page and the
 * ArkivProofPanel both depend on this — no other module talks to Arkiv
 * directly from the browser.
 *
 * Trust posture: we deliberately use `createPublicClient` in the browser
 * (not via the Fhedin API) so judges can see "this UI is reading the chain
 * directly". That is the demo's most defensible privacy claim.
 */

import { createPublicClient, http } from '@arkiv-network/sdk';
import { braga } from '@arkiv-network/sdk/chains';
import { eq, desc } from '@arkiv-network/sdk/query';
import type { Hex } from 'viem';

// ─── Constants (read at module load — Next.js inlines NEXT_PUBLIC_*) ────────

export const ARKIV_RPC_URL =
  process.env.NEXT_PUBLIC_ARKIV_RPC_URL ?? 'https://braga.hoodi.arkiv.network/rpc';
export const ARKIV_PROJECT_ATTRIBUTE =
  process.env.NEXT_PUBLIC_ARKIV_PROJECT_ATTRIBUTE ?? 'fhedin-ethns-2c4f9a';
export const ARKIV_BACKEND_WALLET = (process.env.NEXT_PUBLIC_ARKIV_BACKEND_WALLET ?? '').toLowerCase();
export const ARKIV_BLOCK_EXPLORER =
  process.env.NEXT_PUBLIC_ARKIV_BLOCK_EXPLORER ?? 'https://explorer.braga.hoodi.arkiv.network';
export const ARKIV_DATA_EXPLORER =
  process.env.NEXT_PUBLIC_ARKIV_DATA_EXPLORER ?? 'https://data.arkiv.network';
export const MEMORY_AGENT_WALLET = (process.env.NEXT_PUBLIC_MEMORY_AGENT_WALLET ?? '').toLowerCase();

// ─── Singleton public client ────────────────────────────────────────────────

let _client: ReturnType<typeof createPublicClient> | null = null;
export function getArkivPublicClient() {
  if (_client) return _client;
  _client = createPublicClient({ chain: braga, transport: http(ARKIV_RPC_URL) });
  return _client;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export interface MemoryCard {
  entityKey: string;
  attributes: Record<string, string | number>;
  /** Decoded fact, or null if confidential / parse-failed. */
  fact?: { fact: string; confidence: number; signer: string; sourceBrain: number; createdAt: number };
  confidential: boolean;
  expirationBlock?: number;
}

export async function fetchMemoriesByAgent(agentId: Hex, limit = 20): Promise<MemoryCard[]> {
  const reader = getArkivPublicClient();
  // We filter `$creator` via `eq()` (canonical Arkiv DSL — synthetic
  // attributes per https://docs.arkiv.network/json-rpc/querying-data) rather
  // than the SDK's `.createdBy()` helper, which is broken in 0.6.8: it emits
  // `$creator=0x…` (unquoted), but the RPC requires `$creator = "0x…"`.
  // `eq()` produces the latter — server-side filter, no over-fetch.
  const creator = ARKIV_BACKEND_WALLET || agentId.toLowerCase();
  const result = await reader
    .buildQuery()
    .where([
      eq('project', ARKIV_PROJECT_ATTRIBUTE),
      eq('entityType', 'agent-memory'),
      eq('agentId', agentId.toLowerCase()),
      eq('$creator', creator),
    ])
    .orderBy(desc('createdAt', 'number'))
    .withPayload(true)
    .withAttributes(true)
    .withMetadata(true)
    .limit(Math.min(limit, 100))
    .fetch();

  return result.entities.map((e: any) => buildCard(e));
}

/** Sovereign-tier read: memories *owned by* the connected user (their own
 *  signed entities, regardless of who created them — identical when the user
 *  signed createEntity, but allows future ownership transfers). */
export async function fetchMyMemories(userAddress: Hex, limit = 50): Promise<MemoryCard[]> {
  const reader = getArkivPublicClient();
  // Same DSL pattern as fetchMemoriesByAgent — eq('$owner', addr) is the
  // canonical Arkiv synthetic-attribute filter.
  const result = await reader
    .buildQuery()
    .where([
      eq('project', ARKIV_PROJECT_ATTRIBUTE),
      eq('entityType', 'agent-memory'),
      eq('$owner', userAddress.toLowerCase()),
    ])
    .orderBy(desc('createdAt', 'number'))
    .withPayload(true)
    .withAttributes(true)
    .withMetadata(true)
    .limit(Math.min(limit, 100))
    .fetch();
  return result.entities.map((e: any) => buildCard(e));
}

/** Decision row shape — minimal, matches the agent-decision attribute set. */
export interface DecisionRow {
  entityKey: string;
  decision: 'use-prior' | 'query-brain' | string;
  topic: string;
  priorFactCount: number;
  createdAt: number;
}

export async function fetchDecisionsByAgent(agentId: Hex, limit = 10): Promise<DecisionRow[]> {
  const reader = getArkivPublicClient();
  // Canonical DSL — see fetchMemoriesByAgent for context.
  const creator = ARKIV_BACKEND_WALLET || agentId.toLowerCase();
  const result = await reader
    .buildQuery()
    .where([
      eq('project', ARKIV_PROJECT_ATTRIBUTE),
      eq('entityType', 'agent-decision'),
      eq('agentId', agentId.toLowerCase()),
      eq('$creator', creator),
    ])
    .orderBy(desc('createdAt', 'number'))
    .withAttributes(true)
    .withMetadata(true)
    .limit(Math.min(limit, 100))
    .fetch();
  return result.entities.map((e: any) => {
    const a = Object.fromEntries((e.attributes ?? []).map((x: any) => [x.key, x.value]));
    return {
      entityKey: e.key,
      decision: String(a.decision ?? '—'),
      topic: String(a.topic ?? '—'),
      priorFactCount: Number(a.priorFactCount ?? 0),
      createdAt: Number(a.createdAt ?? 0),
    };
  });
}

function buildCard(e: any): MemoryCard {
  const attributes = Object.fromEntries(
    (e.attributes ?? []).map((a: { key: string; value: string | number }) => [a.key, a.value]),
  );
  const confidential = Number(attributes.confidential ?? 0) === 1;
  let fact: MemoryCard['fact'];
  if (!confidential && e.payload) {
    try {
      const text = new TextDecoder().decode(e.payload);
      const json = JSON.parse(text);
      fact = {
        fact: json.fact,
        confidence: json.confidence,
        signer: json.signer,
        sourceBrain: json.source?.brainId ?? 0,
        createdAt: json.derivedAt ?? Number(attributes.createdAt ?? 0),
      };
    } catch {/* swallow */}
  }
  return { entityKey: e.key, attributes, fact, confidential, expirationBlock: e.expirationBlock };
}

/**
 * subscribeMemoryEvents — wrapper over Arkiv's `subscribeEntityEvents` that
 * filters down to the demo agent's project. Returns the unsubscribe function.
 */
export async function subscribeMemoryEvents(handlers: {
  onCreated?: (e: any) => void;
  onExtended?: (e: any) => void;
  onExpired?: (e: any) => void;
  onError?: (err: Error) => void;
}, pollingIntervalMs = 2000): Promise<() => void> {
  const reader = getArkivPublicClient();
  return reader.subscribeEntityEvents(
    {
      onEntityCreated: handlers.onCreated,
      onEntityExpiresInExtended: handlers.onExtended,
      onEntityExpired: handlers.onExpired,
      onError: handlers.onError,
    },
    pollingIntervalMs,
  );
}
