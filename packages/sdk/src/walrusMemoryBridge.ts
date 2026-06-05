/**
 * walrusMemoryBridge.ts — bridges Walrus Memory namespaces to OpenX brains.
 *
 * Walrus Memory (launched 2026-06-03) exposes the canonical 4-verb agent-memory
 * API on Sui (`@mysten-incubation/memwal`). OpenX runs a commercial overlay:
 * the bridge mirrors a buyer's existing namespace into an OpenX brain (paid
 * publish), and reverse-mirrors any paid OpenX brain into the buyer's
 * personal namespace (post-receipt).
 *
 * SOLID:
 *   - SRP: this file owns ONE class — the bidirectional bridge — and nothing
 *     else. It does not wrap MemWal's full surface; it only uses the verbs
 *     it needs (`recall`, `restore`, `rememberBulk`, `compatibility`).
 *   - DI: caller passes in an OpenX API URL + wallet address; the
 *     `@mysten-incubation/memwal` import is dynamic + optional (G4) so
 *     Standard-tier users' `npm install` doesn't pull MemWal.
 *   - LSP: API mirrors `OpenXClient.remember/recall` shape so the bridge
 *     can stand in for either direction.
 *
 * G4 isolation (Adjustment 5):
 *   - Constructor throws when `tier !== 'trustless'`.
 *   - Constructor throws a clear error when `@mysten-incubation/memwal` is
 *     not installed (peer dependency, declared optional in package.json).
 *
 * For the Day-30 partnership ask: this file ships in @fhe-ai-context/sdk
 * and graduates to a standalone @openx/walrus-memory-bridge package only
 * when Mysten DevRel asks for the install path. Until then, callers depend
 * on the SDK and add MemWal themselves.
 */

import type { CognitiveTier } from './cognitive/types';

// MemWal's public surface (re-typed locally to avoid a hard import).
interface MemWalConfigLike {
  key: string;
  accountId: string;
  serverUrl?: string;
  namespace?: string;
}
interface MemWalLike {
  compatibility(): Promise<unknown>;
  restore(namespace: string, limit?: number): Promise<{ restored: number; total: number }>;
  recall(params: { query: string; limit?: number; namespace?: string }): Promise<{
    results: Array<{ blob_id: string; text: string; distance: number }>;
    total: number;
  }>;
  rememberBulk(items: Array<{ text: string; namespace?: string }>): Promise<{
    job_ids: string[];
    total: number;
  }>;
}
interface MemWalModule {
  MemWal: { create(cfg: MemWalConfigLike): MemWalLike };
}

export interface WalrusMemoryBridgeConfig {
  tier: CognitiveTier;
  /** OpenX API base — e.g. https://13-229-63-192.sslip.io */
  openxApiUrl: string;
  /** Sui wallet address (seller / buyer). */
  walletAddress: string;
  /** MemWal delegate key (hex). */
  memwalKey: string;
  /** MemWal account object id on Sui. */
  memwalAccountId: string;
  /** Override the default relayer (relayer.memory.walrus.xyz). */
  memwalServerUrl?: string;
}

export interface PublishNamespaceOpts {
  namespace: string;
  /** Title for the new OpenX brain. */
  title: string;
  /** Per-query price in USDC (string, e.g. "0.05"). */
  pricePerQueryUsdc: string;
  /** Topic-style tags for marketplace filtering. */
  tags?: string[];
  /** Limit how many memories to mirror in the first pass. */
  limit?: number;
}

export interface RunOpenXBrainAsMemoryOpts {
  /** OpenX brain id to mirror into. */
  brainId: string;
  /** Target namespace in the buyer's MemWal account. */
  namespace: string;
  /** Sample queries to seed the namespace with — defaults to "summary" + "key facts". */
  seedQueries?: string[];
}

export interface BridgeProgressEvent {
  phase: 'compat' | 'restore' | 'fetch' | 'publish' | 'recall' | 'remember' | 'done';
  count?: number;
  message?: string;
}

/**
 * The bridge. Construct once per (wallet × tier).
 *
 *   const bridge = new WalrusMemoryBridge({ tier: 'trustless', ... });
 *   await bridge.publishNamespaceAsBrain({ namespace: 'pham-marketing', ... });
 *   await bridge.runOpenXBrainAsMemory({ brainId: '42', namespace: 'pham' });
 */
export class WalrusMemoryBridge {
  private readonly memwal: MemWalLike;
  private readonly cfg: WalrusMemoryBridgeConfig;

  constructor(cfg: WalrusMemoryBridgeConfig) {
    if (cfg.tier !== 'trustless') {
      throw new Error('WalrusMemoryBridge requires tier="trustless".');
    }
    let mod: MemWalModule;
    try {
      // Dynamic require — keeps the dependency optional for Standard-tier users.
      // The peer-dep is declared as optional in packages/sdk/package.json.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require('@mysten-incubation/memwal') as MemWalModule;
    } catch {
      throw new Error(
        'WalrusMemoryBridge requires @mysten-incubation/memwal to be installed as a peer dependency. ' +
          'Run: npm install @mysten-incubation/memwal',
      );
    }
    this.memwal = mod.MemWal.create({
      key: cfg.memwalKey,
      accountId: cfg.memwalAccountId,
      serverUrl: cfg.memwalServerUrl,
    });
    this.cfg = cfg;
  }

  /**
   * Mirror an existing Walrus Memory namespace into a new paid OpenX brain.
   *
   * Flow:
   *   1. Verify SDK ↔ relayer compatibility (raises on mismatch — G4 hardens).
   *   2. `restore(namespace)` so the relayer's index is fresh.
   *   3. `recall("*")` (or sentinel queries) to enumerate memory bodies.
   *   4. POST /v3/agents/from-brain or /v3/brains to publish; returns the new brain id.
   *
   * Returns the new OpenX brain id + the count of memories mirrored.
   */
  async publishNamespaceAsBrain(
    opts: PublishNamespaceOpts,
    onProgress?: (e: BridgeProgressEvent) => void,
  ): Promise<{ brainId: string; mirroredCount: number }> {
    onProgress?.({ phase: 'compat' });
    await this.memwal.compatibility();

    onProgress?.({ phase: 'restore' });
    await this.memwal.restore(opts.namespace);

    onProgress?.({ phase: 'fetch' });
    // Pull a representative sample. Walrus Memory is similarity-indexed; we
    // surface the highest-distance entries by issuing a broad query, then
    // sort by distance ascending in the caller. For a true full-namespace
    // dump, callers should use MemWalManual; that's a Day-60 enhancement.
    const out = await this.memwal.recall({
      query: '*',
      namespace: opts.namespace,
      limit: opts.limit ?? 50,
    });
    const memories = out.results.map((r) => r.text);

    onProgress?.({ phase: 'publish', count: memories.length });
    const r = await fetch(`${this.cfg.openxApiUrl}/v3/agents/from-brain`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-wallet-address': this.cfg.walletAddress,
        'x-chain': 'sui',
      },
      body: JSON.stringify({
        title: opts.title,
        description: `Mirrored from Walrus Memory namespace "${opts.namespace}" via @openx/walrus-memory-bridge.`,
        body: memories.join('\n\n---\n\n'),
        tags: opts.tags ?? ['walrus-memory'],
        chain: 'sui',
        pricing: { sui_usdc: opts.pricePerQueryUsdc },
      }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`OpenX publish failed ${r.status}: ${text.slice(0, 200)}`);
    }
    const j = (await r.json()) as { id: string | number };
    onProgress?.({ phase: 'done' });
    return { brainId: String(j.id), mirroredCount: memories.length };
  }

  /**
   * Reverse direction: pull a paid OpenX brain's content into a buyer's
   * Walrus Memory namespace. Caller must already hold a paid receipt
   * (the OpenX endpoint requires authenticated wallet header + Sui chain).
   */
  async runOpenXBrainAsMemory(
    opts: RunOpenXBrainAsMemoryOpts,
    onProgress?: (e: BridgeProgressEvent) => void,
  ): Promise<{ blobJobIds: string[]; total: number }> {
    onProgress?.({ phase: 'compat' });
    await this.memwal.compatibility();

    onProgress?.({ phase: 'recall' });
    const queries = opts.seedQueries ?? ['summary', 'key facts'];
    const collected = new Map<string, string>(); // dedup by content
    for (const q of queries) {
      const r = await fetch(`${this.cfg.openxApiUrl}/v3/agents/${opts.brainId}/try`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': this.cfg.walletAddress,
          'x-chain': 'sui',
        },
        body: JSON.stringify({ message: q, chain: 'sui' }),
      });
      if (!r.ok) continue;
      const j = (await r.json()) as { response?: string; answer?: string };
      const text = j.response ?? j.answer;
      if (text) collected.set(text.slice(0, 80), text);
    }

    onProgress?.({ phase: 'remember', count: collected.size });
    const items = Array.from(collected.values()).map((text) => ({
      text,
      namespace: opts.namespace,
    }));
    const result = await this.memwal.rememberBulk(items);
    onProgress?.({ phase: 'done' });
    return { blobJobIds: result.job_ids, total: result.total };
  }
}
