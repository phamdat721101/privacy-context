import {
  encryptContent,
  encryptContentWithKey,
  decryptContent,
  type BrainClient,
  type BrainClientOptions,
  type Brain,
  type ChatHistoryItem,
  type ChatMode,
  type ChatResponse,
  type PublishMeta,
  type SubscribeResult,
  type Tier,
  type UploadResult,
} from '@fhe-ai-context/sdk';
import { createWalrusStore, type WalrusStore } from './storage/walrusStore';
import {
  createSealKeyClient,
  type SealKeyClient,
  type SealSubscriptionProof,
  type SealKYAClaim,
} from './seal/sealKeyClient';
import {
  createPhalaClient,
  type PhalaInferenceClient,
  type InferenceMessage,
} from './inference/phalaTeeInference';

/**
 * Sui-side BrainClient implementation.
 *
 * Flow (for the operations wired in T6/T8):
 *   uploadEncrypted: AES-256-GCM(content) → Seal IBE wrap(key, identity) → Walrus(blob)
 *   chat (learn):    fetch chunks(walrus) → Seal unwrap(key) → AES decrypt → assemble answer
 *
 * What is NOT wired here yet:
 *   - The actual Sui transaction submission to `brain_registry::create_brain`
 *     and `subscription_policy::subscribe` — happens in T11/T14 via `@mysten/sui`.
 *   - Phala TEE inference for the chat answer — T9 replaces the mock response.
 *   - On-chain authorize_read — for now we accept any non-empty subscription
 *     proof; T11 wires the real RPC check.
 */
export class SealBrainClient implements BrainClient {
  private readonly walrus: WalrusStore;
  private readonly seal: SealKeyClient;
  private readonly inference: PhalaInferenceClient;

  /** In-memory store of brain metadata for v1 mock — replaced by Sui RPC reads in T11. */
  private readonly brains = new Map<number, BrainRecord>();
  private nextBrainId = 1;

  /** Current mock subscription proof (per `BrainClientOptions.walletAddress`). */
  private subscription?: SealSubscriptionProof;
  /** KYA claim presented for kya_required brains. Set via setKYAClaim before chat(). */
  private kyaClaim?: SealKYAClaim;

  constructor(private readonly opts: BrainClientOptions) {
    this.walrus = createWalrusStore();
    this.seal = createSealKeyClient();
    this.inference = createPhalaClient();
  }

  // -------- BrainClient implementation ----------------------------------

  async subscribe(tier: Tier): Promise<SubscribeResult> {
    // Mock subscription — T11 replaces with real `subscription_policy::subscribe` Sui tx.
    const expiresAt = new Date(Date.now() + tierToMs(tier)).toISOString();
    const txHash = `mock-sui-${Date.now().toString(16)}`;
    this.subscription = { suiObjectId: `0xmocksub-${this.opts.walletAddress ?? 'anon'}`, signature: 'mock-sig' };
    return { txHash, expiresAt, tier };
  }

  async chat(message: string, brainId?: string, mode: ChatMode = 'learn'): Promise<ChatResponse> {
    if (!this.subscription) {
      throw new Error('Subscription required. Call subscribe() first.');
    }
    if (mode === 'store') {
      // Treat as a small uploadEncrypted that appends to brainId — mock for v1.
      await this.uploadEncrypted(message, brainId);
      return { response: 'Stored.', stored: true, sources: [] };
    }

    if (!brainId) {
      throw new Error('chat in learn mode requires brainId');
    }
    const id = Number(brainId);
    const record = this.brains.get(id);
    if (!record) throw new Error(`brain ${id} not found`);

    // Fetch + decrypt every chunk; assemble plaintext.
    const plaintexts: string[] = [];
    for (const blobRef of record.walrusBlobIds) {
      const ciphertext = await this.walrus.fetch(blobRef);
      const aesKey = record.aesKey
        ? record.aesKey
        : Buffer.from(
            await this.seal.decryptKey({
              identity: record.identity,
              ciphertext: record.sealCiphertext,
              subscriptionProof: this.subscription,
              kyaClaim: this.kyaClaim,
            }),
          );
      plaintexts.push(decryptContent(Buffer.from(ciphertext), aesKey));
    }

    // T9: Phala TEE inference. Mock client returns deterministic answer +
    // synthetic attestation; http client (when PHALA_API_KEY set) returns the
    // real GPU/TDX/SEV attestation quote.
    const sysContext = plaintexts.map((p, i) => `[chunk ${i}]\n${p}`).join('\n\n');
    const messages: InferenceMessage[] = [
      {
        role: 'system',
        content:
          'You are a confidential AI second brain. Answer ONLY from the provided source chunks. ' +
          'Cite chunks by index when used.\n\n' +
          sysContext,
      },
      { role: 'user', content: message },
    ];
    const result = await this.inference.infer(messages);

    return {
      response: result.answer,
      stored: false,
      sources: plaintexts.map((_, i) => `chunk-${i}`),
      attestation: result.attestation,
    };
  }

  async upload(file: Blob, brainId?: string): Promise<UploadResult> {
    const text = await file.text();
    return this.uploadEncrypted(text, brainId);
  }

  async uploadEncrypted(content: string, brainId?: string): Promise<UploadResult> {
    // Each brain owns a single content-key for the lifetime of its chunks.
    // - New brain: mint a key, wrap via Seal, cache on the record.
    // - Existing brain: reuse the cached key. (In production T11 unwraps via
    //   Seal on first access and keeps the result in a session cache.)
    const id = brainId ? Number(brainId) : this.nextBrainId++;
    const identity = `brain:${id}:subscriber`;

    let record = this.brains.get(id);
    if (!record) {
      // Fresh brain — generate AES key + wrap.
      const { encrypted, key } = encryptContent(content);
      const sealCiphertext = await this.seal.encryptKey({ identity, key: new Uint8Array(key) });
      const upload = await this.walrus.upload(new Uint8Array(encrypted));
      record = {
        id,
        identity,
        sealCiphertext,
        aesKey: key,
        walrusBlobIds: upload.blobs.map((b) => b.blobId),
        owner: this.opts.walletAddress ?? '0xanon',
        title: `Brain ${id}`,
        description: '',
        tags: [],
        published: false,
        createdAt: new Date().toISOString(),
      };
      this.brains.set(id, record);
      return { brainId: id, estimatedChunks: upload.blobs.length };
    }

    // Append: reuse the cached AES key, append a new ciphertext chunk.
    const { encrypted } = encryptContentWithKey(content, record.aesKey);
    const upload = await this.walrus.upload(new Uint8Array(encrypted));
    record.walrusBlobIds.push(...upload.blobs.map((b) => b.blobId));
    return { brainId: id, estimatedChunks: upload.blobs.length };
  }

  async listBrains(_page = 1): Promise<Brain[]> {
    return [...this.brains.values()].filter((b) => b.published).map(toBrainView);
  }

  async searchBrains(query: string): Promise<Brain[]> {
    const q = query.toLowerCase();
    return [...this.brains.values()]
      .filter((b) => b.published && (b.title.toLowerCase().includes(q) || b.tags.some((t) => t.toLowerCase().includes(q))))
      .map(toBrainView);
  }

  async getBrain(id: string | number): Promise<Brain> {
    const record = this.brains.get(Number(id));
    if (!record) throw new Error(`brain ${id} not found`);
    return toBrainView(record);
  }

  async publishBrain(brainId: number, meta: PublishMeta): Promise<Brain> {
    const record = this.brains.get(brainId);
    if (!record) throw new Error(`brain ${brainId} not found`);
    record.title = meta.title;
    record.description = meta.description ?? record.description;
    record.tags = meta.tags ?? record.tags;
    record.published = true;
    return toBrainView(record);
  }

  async getMyBrains(): Promise<Brain[]> {
    const me = this.opts.walletAddress?.toLowerCase();
    return [...this.brains.values()]
      .filter((b) => !me || b.owner.toLowerCase() === me)
      .map(toBrainView);
  }

  async getHistory(_brainId?: string, _limit = 20): Promise<ChatHistoryItem[]> {
    // v1: chat history persistence on Sui side lands later (was T4-style work for Fhenix).
    return [];
  }

  // -------- Internal helpers exposed for T9 / T11 -----------------------

  /**
   * Present a KYA claim (from `verifyAgent` in `@fhe-ai-context/sdk`) so that
   * subsequent `chat()` calls can read brains where `kya_required = true`.
   */
  setKYAClaim(claim: SealKYAClaim): void {
    this.kyaClaim = claim;
  }

  /**
   * Cross-chain migration support: emit the plaintext chunks of a brain owned
   * by this client. Used by `migrateBrain` (T12). Production callers unwrap
   * the AES key via Seal once; we rely on the in-memory cache here.
   */
  async exportPlaintextChunks(brainId: number): Promise<string[]> {
    const record = this.brains.get(brainId);
    if (!record) throw new Error(`brain ${brainId} not found`);
    const out: string[] = [];
    for (const blobId of record.walrusBlobIds) {
      const ciphertext = await this.walrus.fetch(blobId);
      out.push(decryptContent(Buffer.from(ciphertext), record.aesKey));
    }
    return out;
  }
}

// -------- Module-private types --------------------------------------------

interface BrainRecord {
  id: number;
  identity: string;
  sealCiphertext: Uint8Array;
  /** Cached plaintext AES key for this brain. In production this is the result of one Seal unwrap, kept for the session. */
  aesKey: Buffer;
  walrusBlobIds: string[];
  owner: string;
  title: string;
  description: string;
  tags: string[];
  published: boolean;
  createdAt: string;
}

function toBrainView(r: BrainRecord): Brain {
  return {
    id: r.id,
    owner_address: r.owner,
    title: r.title,
    description: r.description,
    tags: r.tags,
    published: r.published,
    created_at: r.createdAt,
    chain: 'sui',
  };
}

function tierToMs(tier: Tier): number {
  if (tier === 'week') return 7 * 86_400_000;
  if (tier === 'month') return 30 * 86_400_000;
  return 90 * 86_400_000;
}
