/**
 * tatumClient.ts — single outbound boundary for Tatum API + Walrus aggregator probes.
 *
 * THREE Tatum surfaces wrapped (per PRD §3 functional requirements):
 *   1. Notifications API (api.tatum.io/v3/subscription) — REQUIRES x-api-key
 *   2. Crypto Price API (api.tatum.io/v3/tatum/rate)    — anonymous tier ok; key lifts quota
 *   3. Sui RPC Gateway  (sui-*.gateway.tatum.io)        — JSON-RPC; key lifts free-tier
 *
 * PLUS one auxiliary verification co-located here for sovereignty-proof:
 *   4. Walrus aggregator HEAD probe — not Tatum, but a single client makes the
 *      sovereignty-proof endpoint depend on ONE injection point.
 *
 * SOLID:
 *   - SRP:  this file is the only module in the repo that imports `https://api.tatum.io`
 *           or hits the Sui Gateway directly. All other code consumes ITatumClient.
 *   - DIP:  callers depend on ITatumClient; concrete client constructed at boot.
 *   - LSP:  TatumClient and MockTatumClient are interchangeable.
 *   - OCP:  adding a 4th Tatum surface = adding a method to ITatumClient + body. No file change elsewhere.
 *
 * Error types are exported so callers can pattern-match instead of parsing strings.
 * 24-hour in-process cache for the WAL/USD rate (single-instance API; no Redis dep).
 */

import { resilientCall } from '@fhe-ai-context/runtime-utils';

// ─── Errors ─────────────────────────────────────────────────────────────────

export class TatumKeyMissingError extends Error {
  readonly code = 'TATUM_KEY_MISSING' as const;
  constructor(surface: string) {
    super(
      `Tatum ${surface} requires TATUM_API_KEY. ` +
        'Get a free key at https://dashboard.tatum.io and set TATUM_API_KEY in .env.',
    );
    this.name = 'TatumKeyMissingError';
  }
}

export class TatumRateLimitedError extends Error {
  readonly code = 'TATUM_RATE_LIMITED' as const;
  constructor(surface: string) {
    super(`Tatum ${surface} rate-limited (HTTP 429). Set TATUM_API_KEY for a higher quota.`);
    this.name = 'TatumRateLimitedError';
  }
}

export class TatumDownError extends Error {
  readonly code = 'TATUM_DOWN' as const;
  constructor(surface: string, status: number) {
    super(`Tatum ${surface} returned ${status} after retries.`);
    this.name = 'TatumDownError';
  }
}

/**
 * Thrown when Tatum responds 400 with a validation error indicating the
 * requested `attr.chain` is not in their supported enum. As of 2026-06-04,
 * SUI is NOT in Tatum's Notifications chain enum — they support arb/base/
 * ethereum/etc. but not Sui. This error makes that constraint explicit so
 * callers can fall back to a different mechanism (polling, Sui websocket).
 */
export class TatumChainNotSupportedError extends Error {
  readonly code = 'TATUM_CHAIN_NOT_SUPPORTED' as const;
  constructor(chain: string, surface: string) {
    super(
      `Tatum ${surface} does not support chain "${chain}". ` +
        'See https://docs.tatum.io/docs/notifications for the current chain enum.',
    );
    this.name = 'TatumChainNotSupportedError';
  }
}

// ─── Interface ──────────────────────────────────────────────────────────────

export interface SubscribeResult {
  id: string;
}

export interface WalUsdRate {
  usdPerWal: number;
  cached: boolean;
  /** Unix ms. */
  updatedAt: number;
}

export interface SuiObjectInfo {
  exists: boolean;
  digest?: string;
  type?: string;
}

export interface WalrusBlobInfo {
  exists: boolean;
  sizeBytes?: number;
}

export interface ITatumClient {
  subscribeAddress(suiAddress: string, webhookUrl: string, chain?: string): Promise<SubscribeResult>;
  unsubscribeAddress(subscriptionId: string): Promise<void>;
  getWalUsdRate(): Promise<WalUsdRate>;
  getSuiObject(objectId: string): Promise<SuiObjectInfo>;
  getWalrusBlob(blobId: string): Promise<WalrusBlobInfo>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Hardcoded fallback per Walrus pricing announcement (May 13, 2026): $0.023/GB/mo. */
const WAL_USD_FALLBACK = 0.023;
const RATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const RPC_GATEWAY: Record<'testnet' | 'mainnet', string> = {
  testnet: 'https://sui-testnet.gateway.tatum.io',
  mainnet: 'https://sui-mainnet.gateway.tatum.io',
};

// ─── Real client ────────────────────────────────────────────────────────────

export interface TatumClientConfig {
  apiKey?: string;
  suiNetwork?: 'testnet' | 'mainnet';
  walrusAggregatorUrl?: string;
}

export class TatumClient implements ITatumClient {
  private readonly apiKey?: string;
  private readonly suiNetwork: 'testnet' | 'mainnet';
  private readonly walrusAggregatorUrl: string;
  private rateCache: { usdPerWal: number; updatedAt: number } | null = null;

  constructor(cfg: TatumClientConfig = {}) {
    this.apiKey = cfg.apiKey?.trim() || undefined;
    this.suiNetwork = cfg.suiNetwork ?? 'testnet';
    this.walrusAggregatorUrl =
      cfg.walrusAggregatorUrl?.replace(/\/$/, '') ??
      'https://aggregator.walrus-testnet.walrus.space';
  }

  hasKey(): boolean {
    return !!this.apiKey;
  }

  // 1. Notifications — REQUIRES key. NB: as of 2026-06-04 Tatum does NOT support SUI
  //    in attr.chain. This method will throw TatumChainNotSupportedError for Sui addresses
  //    until Tatum adds it to their enum. EVM chains (base, arb, ethereum, etc.) work today.
  async subscribeAddress(
    suiAddress: string,
    webhookUrl: string,
    chain: string = 'SUI',
  ): Promise<SubscribeResult> {
    if (!this.apiKey) throw new TatumKeyMissingError('Notifications.subscribe');
    return resilientCall({ name: 'tatum-subscribe' }, async () => {
      const r = await fetch('https://api.tatum.io/v3/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey! },
        body: JSON.stringify({
          type: 'ADDRESS_TRANSACTION',
          attr: { chain, address: suiAddress, url: webhookUrl },
        }),
      });
      if (r.status === 429) throw new TatumRateLimitedError('Notifications.subscribe');
      if (r.status === 400) {
        const body = (await r.json().catch(() => ({}))) as { data?: string[] };
        const msg = (body.data ?? []).join(' ');
        if (/attr\.chain must be one of/i.test(msg)) {
          throw new TatumChainNotSupportedError(chain, 'Notifications.subscribe');
        }
        throw new TatumDownError(`Notifications.subscribe: ${msg.slice(0, 200)}`, 400);
      }
      if (!r.ok) throw new TatumDownError('Notifications.subscribe', r.status);
      return (await r.json()) as SubscribeResult;
    });
  }

  async unsubscribeAddress(subscriptionId: string): Promise<void> {
    if (!this.apiKey) throw new TatumKeyMissingError('Notifications.unsubscribe');
    await resilientCall({ name: 'tatum-unsubscribe' }, async () => {
      const r = await fetch(`https://api.tatum.io/v3/subscription/${subscriptionId}`, {
        method: 'DELETE',
        headers: { 'x-api-key': this.apiKey! },
      });
      if (r.status === 404) return; // idempotent
      if (r.status === 429) throw new TatumRateLimitedError('Notifications.unsubscribe');
      if (!r.ok) throw new TatumDownError('Notifications.unsubscribe', r.status);
    });
  }

  // 2. Crypto Price — anonymous tier acceptable; cached 24h.
  async getWalUsdRate(): Promise<WalUsdRate> {
    if (this.rateCache && Date.now() - this.rateCache.updatedAt < RATE_CACHE_TTL_MS) {
      return { ...this.rateCache, cached: true };
    }
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) headers['x-api-key'] = this.apiKey;
      const r = await fetch('https://api.tatum.io/v3/tatum/rate/WAL?basePair=USD', { headers });
      if (!r.ok) throw new TatumDownError('CryptoPrice.rate', r.status);
      const json = (await r.json()) as { value?: string | number };
      const usdPerWal = Number(json.value);
      if (!Number.isFinite(usdPerWal) || usdPerWal <= 0) throw new Error('bad-rate-shape');
      this.rateCache = { usdPerWal, updatedAt: Date.now() };
      return { usdPerWal, cached: false, updatedAt: this.rateCache.updatedAt };
    } catch {
      // Graceful degradation — return hardcoded fallback so the dashboard never breaks.
      return {
        usdPerWal: WAL_USD_FALLBACK,
        cached: true,
        updatedAt: this.rateCache?.updatedAt ?? Date.now(),
      };
    }
  }

  // 3. Sui RPC Gateway — JSON-RPC sui_getObject. Anonymous works; key lifts quota.
  async getSuiObject(objectId: string): Promise<SuiObjectInfo> {
    return resilientCall({ name: 'tatum-sui-object' }, async () => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.apiKey) headers['x-api-key'] = this.apiKey;
      const r = await fetch(RPC_GATEWAY[this.suiNetwork], {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sui_getObject',
          params: [objectId, { showType: true, showContent: false }],
        }),
      });
      if (r.status === 429) throw new TatumRateLimitedError('SuiRPC.getObject');
      if (!r.ok) throw new TatumDownError('SuiRPC.getObject', r.status);
      const j = (await r.json()) as {
        result?: { data?: { digest?: string; type?: string }; error?: unknown };
      };
      const data = j.result?.data;
      if (!data) return { exists: false };
      return { exists: true, digest: data.digest, type: data.type };
    });
  }

  // 4. Walrus aggregator HEAD — independent of Tatum; co-located for one-shot sovereignty proof.
  async getWalrusBlob(blobId: string): Promise<WalrusBlobInfo> {
    // Walrus blob ids look like `walrus:abc...` or raw base64. Strip the prefix.
    const id = blobId.replace(/^walrus:/, '');
    return resilientCall({ name: 'walrus-aggregator-head' }, async () => {
      const r = await fetch(`${this.walrusAggregatorUrl}/v1/blobs/${id}`, { method: 'HEAD' });
      if (r.status === 404) return { exists: false };
      if (!r.ok) throw new TatumDownError('Walrus.getBlob', r.status);
      const len = r.headers.get('content-length');
      return { exists: true, sizeBytes: len ? Number(len) : undefined };
    });
  }
}

// ─── Mock client (for DRY smoke + unit tests) ───────────────────────────────

export class MockTatumClient implements ITatumClient {
  private subId = 0;
  hasKey() {
    return false;
  }
  async subscribeAddress(): Promise<SubscribeResult> {
    return { id: `mock-sub-${++this.subId}` };
  }
  async unsubscribeAddress(): Promise<void> {
    /* no-op */
  }
  async getWalUsdRate(): Promise<WalUsdRate> {
    return { usdPerWal: WAL_USD_FALLBACK, cached: true, updatedAt: Date.now() };
  }
  async getSuiObject(objectId: string): Promise<SuiObjectInfo> {
    if (!objectId || objectId === '0x0') return { exists: false };
    return { exists: true, digest: `mock-digest-${objectId.slice(-6)}`, type: 'mock::Workflow' };
  }
  async getWalrusBlob(blobId: string): Promise<WalrusBlobInfo> {
    if (!blobId || blobId === 'walrus:missing') return { exists: false };
    return { exists: true, sizeBytes: 1024 };
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

let _singleton: ITatumClient | null = null;

/**
 * Returns a process-singleton. Construct once at boot:
 *   - TATUM_API_KEY set → real TatumClient (full feature set, lifted quota).
 *   - TATUM_API_KEY unset → real TatumClient with no key (subscribe surfaces throw
 *     TatumKeyMissingError; price + RPC + Walrus probes still work).
 *
 * Tests that need fully deterministic behavior should construct MockTatumClient directly.
 */
export function createTatumClient(): ITatumClient {
  if (_singleton) return _singleton;
  _singleton = new TatumClient({
    apiKey: process.env.TATUM_API_KEY,
    suiNetwork:
      (process.env.SUI_NETWORK as 'testnet' | 'mainnet') ??
      (process.env.SUI_RPC_URL?.includes('mainnet') ? 'mainnet' : 'testnet'),
    walrusAggregatorUrl: process.env.WALRUS_AGGREGATOR_URL,
  });
  return _singleton;
}

/** Test-only — reset the singleton between smokes. */
export function _resetTatumClientSingleton(): void {
  _singleton = null;
}
