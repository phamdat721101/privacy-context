import { createHash } from 'node:crypto';

/**
 * ERC-8004 Know-Your-Agent (KYA) client — produces and verifies agent identity
 * proofs that the SealBrainClient (Sui) and SubscriptionController (Fhenix)
 * both consume. The on-chain registry lives on EVM (Ethereum / Base / Arbitrum
 * / Mantle, per geterc8004.com) regardless of which chain the brain is on.
 *
 * SOLID:
 * - Single Responsibility: this file produces / verifies KYA proofs only;
 *   nothing about brains, payments, or chains beyond the EVM registry.
 * - Liskov: `MockKyaClient` and `HttpKyaClient` are interchangeable.
 * - Open/Closed: a future on-chain ERC-8004 client (viem-backed) plugs in by
 *   adding a third implementation; no consumer change.
 *
 * v1 deployment posture:
 *   - When `ERC8004_RPC_URL` is unset, the mock signs deterministically and
 *     verifies any non-empty proof — sufficient for SDK demos and the
 *     showcase script (T14).
 *   - When set, the http impl will query the canonical ERC-8004 registry. The
 *     wire body is left as a documented stub here so wiring viem in T14/T15
 *     is mechanical.
 */

export interface KyaProof {
  agentAddress: string;
  reputation: number;
  /** Hex-encoded signature bytes (real impl: EIP-712 signature). */
  proof: string;
  /** Challenge string the proof attests over. */
  challenge: string;
}

export interface KyaClient {
  /** Sign a challenge with the agent's identity. Used right before subscribing. */
  signChallenge(opts: { agentAddress: string; challenge: string }): Promise<KyaProof>;

  /** Verify an externally-presented KYA proof. */
  verify(proof: KyaProof, minReputation: number): Promise<boolean>;
}

export interface KyaConfig {
  /** ERC-8004 registry address (EVM). Defaults to the canonical Base mainnet deployment. */
  registryAddress?: string;
  /** EVM RPC URL. Empty → mock. */
  rpcUrl?: string;
}

const DEFAULT_REGISTRY = '0xERC8004CanonicalRegistryAddress';

// ---------- Mock implementation -------------------------------------------

class MockKyaClient implements KyaClient {
  async signChallenge({ agentAddress, challenge }: { agentAddress: string; challenge: string }): Promise<KyaProof> {
    // Deterministic mock signature: sha256(agent + challenge).
    const proof = createHash('sha256')
      .update(`${agentAddress.toLowerCase()}|${challenge}`)
      .digest('hex');
    // Reputation is derived from the AGENT ADDRESS alone (not the challenge),
    // so it stays stable across calls/runs — important for repeatable demos.
    const repHex = createHash('sha256').update(agentAddress.toLowerCase()).digest('hex').slice(0, 2);
    const reputation = Number.parseInt(repHex, 16) % 101;
    return { agentAddress, reputation, proof: `0x${proof}`, challenge };
  }

  async verify(proof: KyaProof, minReputation: number): Promise<boolean> {
    if (!proof.proof || proof.proof.length < 4) return false;
    return proof.reputation >= minReputation;
  }
}

// ---------- HTTP implementation (skeleton) --------------------------------

class HttpKyaClient implements KyaClient {
  constructor(private readonly cfg: Required<KyaConfig>) {}

  async signChallenge(_opts: { agentAddress: string; challenge: string }): Promise<KyaProof> {
    throw new Error(
      'HttpKyaClient.signChallenge: wire viem `signTypedData` against the agent wallet. ' +
        'Until then unset ERC8004_RPC_URL to use the mock.',
    );
  }

  async verify(_proof: KyaProof, _minReputation: number): Promise<boolean> {
    throw new Error(
      `HttpKyaClient.verify: wire viem read of ${this.cfg.registryAddress} on ${this.cfg.rpcUrl}. ` +
        'Until then unset ERC8004_RPC_URL to use the mock.',
    );
  }
}

// ---------- Factory --------------------------------------------------------

export function createKyaClient(cfg: KyaConfig = {}): KyaClient {
  const rpcUrl = cfg.rpcUrl ?? process.env.ERC8004_RPC_URL;
  const registryAddress =
    cfg.registryAddress ?? process.env.ERC8004_REGISTRY_ADDRESS ?? DEFAULT_REGISTRY;
  if (!rpcUrl) return new MockKyaClient();
  return new HttpKyaClient({ rpcUrl, registryAddress });
}

/**
 * Convenience: produce a fresh proof for a brain query. The SealBrainClient
 * passes the result into `setKYAClaim` before calling `chat()` on a
 * `kya_required` brain.
 */
export async function verifyAgent(
  agentAddress: string,
  minReputation: number,
  client: KyaClient = createKyaClient(),
): Promise<{ verified: boolean; signedProof: KyaProof }> {
  const challenge = `fhe-second-brain-kya-${Date.now()}`;
  const signedProof = await client.signChallenge({ agentAddress, challenge });
  const verified = await client.verify(signedProof, minReputation);
  return { verified, signedProof };
}
