/**
 * Seal IBE key client — wraps content-encryption keys for an identity (e.g.
 * "brain:<id>:subscriber") and unwraps them via threshold key servers that
 * verify a Move policy before releasing their share.
 *
 * SOLID:
 * - Liskov: `MockSealKeyClient` and `HttpSealKeyClient` are interchangeable.
 * - Open/Closed: a future `MystenSealClient` (when the published `@mysten/seal`
 *   SDK stabilises) plugs in by adding a third implementation.
 * - Dependency Inversion: callers depend on `SealKeyClient`, never on a
 *   specific HTTP client or KMS.
 *
 * "Do not repeat sample mistake": every external HTTP call goes through
 * `resilientCall` from `@fhe-ai-context/runtime-utils`. There is no bare fetch
 * to a Seal key server anywhere in this codebase.
 */

import { createHash, createHmac } from 'node:crypto';
import {
  resilientCall,
  type ResilientLogger,
} from '@fhe-ai-context/runtime-utils';

/** Attestation that the caller holds a valid Move-side `Subscription` for the brain. */
export interface SealSubscriptionProof {
  /** Sui object ID of the `Subscription` capability NFT. */
  suiObjectId: string;
  /** Off-chain signature attesting the subscription is unexpired. T11 sources this from RPC. */
  signature: string;
}

/** Optional KYA claim presented alongside subscription for kya_required brains. */
export interface SealKYAClaim {
  agentAddress: string;
  reputation: number;
  proof: string;
}

export interface EncryptKeyOpts {
  /** IBE identity, e.g. `brain:<brainId>:subscriber`. */
  identity: string;
  /** 32-byte AES-256 key to wrap. */
  key: Uint8Array;
  logger?: ResilientLogger;
}

export interface DecryptKeyOpts {
  identity: string;
  ciphertext: Uint8Array;
  subscriptionProof?: SealSubscriptionProof;
  kyaClaim?: SealKYAClaim;
  logger?: ResilientLogger;
}

export interface SealKeyClient {
  encryptKey(opts: EncryptKeyOpts): Promise<Uint8Array>;
  decryptKey(opts: DecryptKeyOpts): Promise<Uint8Array>;
}

export interface SealConfig {
  /** Comma-separated key-server URLs (or set `SEAL_KEY_SERVERS`). Empty → mock. */
  keyServers?: string[];
  /** Threshold for unwrap (e.g. 2-of-3). Default 2. */
  threshold?: number;
  /**
   * Master secret for the mock derivation. Tests can pass an explicit value;
   * production never sees this path because keyServers != [].
   */
  mockSecret?: string;
}

// ---------- Mock implementation --------------------------------------------

/**
 * Deterministic mock: ciphertext = key XOR HMAC(identity, mockSecret).
 *
 * The mock unconditionally returns the unwrapped key — it does *not* enforce
 * subscription / KYA. That's by design: policy enforcement lives on-chain (the
 * real Seal key servers verify the Move policy). The unit tests around `chat`
 * + `authorize_read` simulate the policy denial separately.
 */
class MockSealKeyClient implements SealKeyClient {
  constructor(private readonly mockSecret: string) {}

  private derive(identity: string): Uint8Array {
    return createHmac('sha256', this.mockSecret).update(identity).digest();
  }

  async encryptKey({ identity, key }: EncryptKeyOpts): Promise<Uint8Array> {
    if (key.byteLength !== 32) throw new Error('Seal mock: key must be 32 bytes');
    const pad = this.derive(identity);
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = key[i] ^ pad[i];
    return out;
  }

  async decryptKey({ identity, ciphertext }: DecryptKeyOpts): Promise<Uint8Array> {
    if (ciphertext.byteLength !== 32) throw new Error('Seal mock: ciphertext must be 32 bytes');
    const pad = this.derive(identity);
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = ciphertext[i] ^ pad[i];
    return out;
  }
}

// ---------- HTTP implementation (skeleton) ---------------------------------

/**
 * HTTP impl for real Seal threshold key servers.
 *
 * Encryption is local IBE wrapping (no servers needed). Decryption queries
 * `threshold` of `keyServers`, each verifies the on-chain Move policy plus the
 * caller's `subscriptionProof` (and optional `kyaClaim`), and returns a key
 * share. Shares are combined client-side.
 *
 * The exact wire format will follow the published `@mysten/seal` SDK once
 * stable; for now this class exposes the contract and throws "not wired yet"
 * with documented next steps.
 */
class HttpSealKeyClient implements SealKeyClient {
  constructor(
    private readonly keyServers: string[],
    private readonly threshold: number,
  ) {}

  async encryptKey(_opts: EncryptKeyOpts): Promise<Uint8Array> {
    throw new Error(
      'HttpSealKeyClient.encryptKey not wired yet. Wire when @mysten/seal is published; ' +
        'until then unset SEAL_KEY_SERVERS to use the mock.',
    );
  }

  async decryptKey(opts: DecryptKeyOpts): Promise<Uint8Array> {
    if (this.keyServers.length < this.threshold) {
      throw new Error(`Seal: need ≥${this.threshold} key servers, have ${this.keyServers.length}`);
    }
    // Sketch — kept here so the resilientCall wiring is pre-baked.
    const _shares: Uint8Array[] = [];
    for (let i = 0; i < this.threshold; i++) {
      const url = this.keyServers[i];
      await resilientCall(
        { name: `seal-key-server-${i}`, logger: opts.logger },
        async () => {
          const res = await fetch(`${url}/v1/key-share`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              identity: opts.identity,
              ciphertext: Buffer.from(opts.ciphertext).toString('base64'),
              subscriptionProof: opts.subscriptionProof,
              kyaClaim: opts.kyaClaim,
            }),
          });
          if (!res.ok) throw new Error(`seal key-server ${i} returned ${res.status}`);
          // Real combination logic lands when SDK is wired.
          return res.arrayBuffer();
        },
      );
    }
    throw new Error(
      'HttpSealKeyClient.decryptKey: share-combination not wired yet (await @mysten/seal stable release).',
    );
  }
}

// ---------- Factory --------------------------------------------------------

/**
 * Pick an implementation. When `keyServers` is empty/unset we return the mock.
 * Real wiring is selected by `SEAL_KEY_SERVERS` env (csv) + optional
 * `SEAL_THRESHOLD` env (default 2).
 */
export function createSealKeyClient(cfg: SealConfig = {}): SealKeyClient {
  const envServers = (process.env.SEAL_KEY_SERVERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const keyServers = cfg.keyServers ?? envServers;
  const threshold = cfg.threshold ?? Number(process.env.SEAL_THRESHOLD ?? 2);

  if (keyServers.length === 0) {
    const mockSecret =
      cfg.mockSecret ??
      process.env.SEAL_MOCK_SECRET ??
      // Stable per-process so encrypt and decrypt agree without any setup. Logged once.
      createHash('sha256').update('fhe-second-brain-mock-secret').digest('hex');
    return new MockSealKeyClient(mockSecret);
  }
  return new HttpSealKeyClient(keyServers, threshold);
}
