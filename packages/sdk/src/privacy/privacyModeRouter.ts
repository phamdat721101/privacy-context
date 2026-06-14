/**
 * privacyModeRouter — picks the correct storage + key-custody adapter pair
 * for a given PrivacyMode. Post-Sui: every published brain is FHE-tier
 * (Fhenix CoFHE on Arbitrum) backed by Supabase Storage for the encrypted
 * payload. The router stays in place because tests + future modes (e.g.
 * 'metadata-only', 'off') still need the dispatch shape.
 *
 * SOLID:
 *   - SRP: dispatch from PrivacyConfig → adapter pair.
 *   - DIP: adapters are constructor-injected; tests pass stubs.
 *   - OCP: new mode = one switch arm + one adapter; the contract is stable.
 */

import type { PrivacyConfig, PrivacyMode } from './types';

export interface StorageAdapter {
  readonly mode: PrivacyMode;
  /** Persist encrypted brain content; returns content-addressed ids. */
  writeBrainContent(args: {
    brainId: string;
    encryptedChunks: Uint8Array[];
  }): Promise<{ blobIds: string[] }>;

  /** Read encrypted brain content back. */
  readBrainContent(args: {
    brainId: string;
    identity: string;
  }): Promise<Uint8Array[]>;
}

export interface KeyCustodyAdapter {
  readonly mode: PrivacyMode;
  wrapKey(args: { key: Uint8Array; ownerAddress: string }): Promise<{ ciphertext: string }>;
  unwrapKey(args: { ciphertext: string; permit: unknown }): Promise<Uint8Array>;
}

export interface CofheClientLike {
  readonly _cofhe: true;
}

export interface PrivacyModeRouter {
  routeStorage(cfg: PrivacyConfig): StorageAdapter;
  routeKeyCustody(cfg: PrivacyConfig): KeyCustodyAdapter;
}

export interface PrivacyModeRouterDeps {
  cofhe: CofheClientLike;
  /** Optional concrete adapter overrides — used by tests. */
  storage?: Partial<Record<PrivacyMode, StorageAdapter>>;
  keyCustody?: Partial<Record<PrivacyMode, KeyCustodyAdapter>>;
}

class FheStorageAdapter implements StorageAdapter {
  readonly mode: PrivacyMode = 'fhe';
  async writeBrainContent(args: { brainId: string; encryptedChunks: Uint8Array[] }) {
    // Real upload happens server-side in `services/supabaseStorage.ts`.
    // The router-level facade returns synthetic blob ids derived from chunk
    // count so callers have a uniform return shape in the SDK layer.
    return { blobIds: args.encryptedChunks.map((_, i) => `supabase:${args.brainId}:${i}`) };
  }
  async readBrainContent() {
    return [];
  }
}

class FhenixKeyCustodyAdapter implements KeyCustodyAdapter {
  readonly mode: PrivacyMode = 'fhe';
  async wrapKey() {
    return { ciphertext: 'fhe:wrapped' }; // BrainKeyVaultV2 path is in cofheClient.ts
  }
  async unwrapKey() {
    return new Uint8Array(32);
  }
}

class PassthroughStorageAdapter implements StorageAdapter {
  constructor(public readonly mode: PrivacyMode) {}
  async writeBrainContent(args: { brainId: string; encryptedChunks: Uint8Array[] }) {
    return { blobIds: args.encryptedChunks.map((_, i) => `passthrough:${args.brainId}:${i}`) };
  }
  async readBrainContent() {
    return [];
  }
}

class PassthroughKeyCustodyAdapter implements KeyCustodyAdapter {
  constructor(public readonly mode: PrivacyMode) {}
  async wrapKey() {
    return { ciphertext: 'passthrough' };
  }
  async unwrapKey() {
    return new Uint8Array(32);
  }
}

export function createPrivacyModeRouter(deps: PrivacyModeRouterDeps): PrivacyModeRouter {
  const fheStorage = deps.storage?.fhe ?? new FheStorageAdapter();
  const fheKey = deps.keyCustody?.fhe ?? new FhenixKeyCustodyAdapter();

  return {
    routeStorage(cfg: PrivacyConfig): StorageAdapter {
      switch (cfg.mode) {
        case 'fhe':
          return fheStorage;
        case 'metadata-only':
        case 'off':
          return deps.storage?.[cfg.mode] ?? new PassthroughStorageAdapter(cfg.mode);
      }
    },
    routeKeyCustody(cfg: PrivacyConfig): KeyCustodyAdapter {
      switch (cfg.mode) {
        case 'fhe':
          return fheKey;
        case 'metadata-only':
        case 'off':
          return deps.keyCustody?.[cfg.mode] ?? new PassthroughKeyCustodyAdapter(cfg.mode);
      }
    },
  };
}
