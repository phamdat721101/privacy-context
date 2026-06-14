/**
 * OpenXClient — 4-verb facade over the Fhenix-tier BrainClient.
 *
 * Public API:
 *   client.remember(text, opts?)   → MemoryId
 *   client.recall(query, opts?)    → RecallResult
 *   client.analyze(text, opts?)    → MemoryId[]
 *   client.ask(query, opts?)       → AskResult       (paid)
 *
 * Post-Sui simplification: single tier (Fhenix CoFHE on Arbitrum). The
 * `restore()` verb (sovereignty proof) was Sui-only and is removed.
 *
 * SOLID:
 *   - SRP: facade only — no direct chain calls, no key custody.
 *   - LSP: any future BrainClient swap leaves the public API behavior unchanged.
 *   - DI: `apiUrl` + `walletAddress` are constructor params; no `process.env`
 *     reads in this class.
 */

import { createBrainClient } from './brain/client';
import type { BrainClient, AttestationReceipt, Brain } from './brain/types';
import { PayRouter, type PaymentReceipt, type WalletPrefs } from './payment/payRouter';

// ---------- Public types ---------------------------------------------------

/** Stable memory identifier — `${namespace}/${id}`. */
export type MemoryId = `${string}/${string}`;

export interface RecallResult {
  memories: Array<{
    id: MemoryId;
    content: string;
    score: number;
    metadata?: Record<string, unknown>;
  }>;
  totalMatches: number;
}

export interface AskResult {
  answer: string;
  citations: MemoryId[];
  attestation?: AttestationReceipt;
  receipt?: PaymentReceipt;
}

export interface RememberOpts {
  namespace?: string;
  metadata?: Record<string, unknown>;
}

export interface RecallOpts {
  topK?: number;
  namespace?: string;
}

export interface AskOpts extends RecallOpts {
  walletPrefs?: WalletPrefs;
  /** Dev-only signer for x402; production callers use a wallet adapter. */
  privateKey?: string;
}

export interface OpenXClientConfig {
  /** Express API URL — defaults to localhost:3001 when unset. */
  apiUrl: string;
  /** Wallet address that owns the brain (creator) or that pays (user). */
  walletAddress: string;
  /** Brain to address by default in single-brain client setups. */
  brainId?: string;
  /** Default namespace used when opts.namespace is unset. */
  defaultNamespace?: string;
  /** Per-query price in USDC (string, e.g. "1.50"). Display-only — server is authoritative. */
  pricePerQuery?: string;
  /** Optional injected PayRouter (tests). */
  payRouter?: PayRouter;
}

/** The 4-verb facade. Construct once per (wallet × api). */
export class OpenXClient {
  /** Namespaced internal API — same logic as the verbs, more explicit names. */
  readonly brain: {
    store: OpenXClient['remember'];
    search: OpenXClient['recall'];
    distill: OpenXClient['analyze'];
    answer: OpenXClient['ask'];
  };

  private readonly inner: BrainClient;
  private readonly router: PayRouter;
  private readonly cfg: OpenXClientConfig & { defaultNamespace: string };

  constructor(cfg: OpenXClientConfig) {
    this.cfg = { defaultNamespace: 'default', ...cfg };
    this.inner = createBrainClient('fhenix', {
      apiUrl: cfg.apiUrl,
      walletAddress: cfg.walletAddress,
    });
    this.router = cfg.payRouter ?? new PayRouter();
    this.brain = {
      store: this.remember.bind(this),
      search: this.recall.bind(this),
      distill: this.analyze.bind(this),
      answer: this.ask.bind(this),
    };
  }

  /** Store text/data as encrypted memory. AES-256-GCM client-side; CoFHE-wrapped key on Arbitrum. */
  async remember(text: string, opts: RememberOpts = {}): Promise<MemoryId> {
    const result = await this.inner.uploadEncrypted(text, this.cfg.brainId);
    const ns = opts.namespace ?? this.cfg.defaultNamespace;
    return `${ns}/${result.brainId}` as MemoryId;
  }

  /** Retrieve memories matching a query. Free — use `ask()` for the paid LLM-answered flow. */
  async recall(query: string, opts: RecallOpts = {}): Promise<RecallResult> {
    const brains = await this.inner.searchBrains(query);
    const ns = opts.namespace ?? this.cfg.defaultNamespace;
    const k = opts.topK ?? 10;
    const memories = brains.slice(0, k).map((b: Brain) => ({
      id: `${ns}/${b.id}` as MemoryId,
      content: b.description ?? '',
      score: 1,
      metadata: { title: b.title, owner: b.owner_address, tags: b.tags },
    }));
    return { memories, totalMatches: brains.length };
  }

  /**
   * Distill text into structured facts. Each fact becomes its own memory.
   * v1: naive sentence-split. Phase 2 swaps for `cognitive/consolidator.ts`.
   */
  async analyze(text: string, opts: RememberOpts = {}): Promise<MemoryId[]> {
    const facts = naiveSplitFacts(text);
    const ids: MemoryId[] = [];
    for (const f of facts) ids.push(await this.remember(f, opts));
    return ids;
  }

  /**
   * LLM-answered query with cited memories + TEE attestation. **Paid.**
   * On HTTP 402, the caller's wallet flow handles payment + retry — the SDK
   * surfaces the challenge; the frontend hooks (`useX402Pay`) wire the loop.
   */
  async ask(query: string, _opts: AskOpts = {}): Promise<AskResult> {
    if (!this.cfg.brainId) throw new Error('OpenXClient.ask: brainId required');
    const r = await this.inner.chat(query, this.cfg.brainId, 'learn');
    return {
      answer: r.response,
      citations: (r.sources ?? []).map(
        (s: string) => `${this.cfg.defaultNamespace}/${s}` as MemoryId,
      ),
      attestation: r.attestation,
    };
  }
}

// ---------- helpers --------------------------------------------------------

function naiveSplitFacts(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
