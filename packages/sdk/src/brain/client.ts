import { encryptContent, splitKey, decryptContent, joinKey } from './encryption';

export { encryptContent, decryptContent, splitKey, joinKey };
export type ChainKey = 'base-sepolia' | 'arbitrum-sepolia';
export type Tier = 'week' | 'month' | 'quarter';

export interface ChatResponse {
  response: string;
  stored: boolean;
  sources: string[];
}

export interface Brain {
  id: number;
  owner_address: string;
  title: string;
  description: string;
  tags: string[];
  published: boolean;
  created_at: string;
}

export class BrainClient {
  constructor(
    private apiUrl: string,
    private chain: ChainKey = 'arbitrum-sepolia',
    private walletAddress?: string,
  ) {}

  private headers() {
    const h: Record<string, string> = { 'Content-Type': 'application/json', 'x-chain': this.chain };
    if (this.walletAddress) h['x-wallet-address'] = this.walletAddress;
    return h;
  }

  private async request<T>(path: string, opts?: RequestInit): Promise<T> {
    const res = await fetch(`${this.apiUrl}${path}`, { ...opts, headers: { ...this.headers(), ...opts?.headers } });
    if (res.status === 402) throw new Error('Subscription required. Call subscribe() first.');
    if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  async subscribe(tier: Tier) {
    // First attempt — if 402, extract payment-required header and retry with payment proof
    const res = await fetch(`${this.apiUrl}/subscribe`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ tier }),
    });

    if (res.status === 402) {
      // x402 challenge received — caller must handle payment externally
      // or use n-payment client: NPayment.fetch(url, init) which auto-pays
      const challenge = res.headers.get('payment-required');
      throw new Error(`x402 payment required. Challenge: ${challenge}`);
    }

    if (!res.ok) throw new Error(`Subscribe failed: ${res.status}`);
    return res.json() as Promise<{ txHash: string; expiresAt: string; tier: string }>;
  }

  async chat(message: string, brainId?: string, mode: 'learn' | 'store' = 'learn') {
    return this.request<ChatResponse>('/chat', {
      method: 'POST',
      body: JSON.stringify({ message, brainId, mode }),
    });
  }

  async upload(file: Blob, brainId?: string) {
    const form = new FormData();
    form.append('file', file);
    if (brainId) form.append('brainId', brainId);
    const res = await fetch(`${this.apiUrl}/upload`, {
      method: 'POST',
      headers: { 'x-wallet-address': this.walletAddress || '', 'x-chain': this.chain },
      body: form,
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json() as Promise<{ brainId: number; estimatedChunks: number }>;
  }

  async listBrains(page = 1) {
    return this.request<Brain[]>(`/brains?page=${page}`);
  }

  async searchBrains(query: string) {
    return this.request<Brain[]>(`/brains/search?q=${encodeURIComponent(query)}`);
  }

  async getBrain(id: string | number) {
    return this.request<Brain>(`/brains/${id}`);
  }

  async publishBrain(brainId: number, meta: { title: string; description?: string; tags?: string[] }) {
    return this.request<Brain>('/brains/publish', {
      method: 'POST',
      body: JSON.stringify({ brainId, ...meta }),
    });
  }

  async getMyBrains() {
    return this.request<Brain[]>('/brains/mine');
  }

  async getHistory(brainId?: string, limit = 20) {
    const params = new URLSearchParams();
    if (brainId) params.set('brainId', brainId);
    params.set('limit', String(limit));
    return this.request<Array<{ role: string; content: string; created_at: string }>>(`/chat/history?${params}`);
  }

  /**
   * Encrypt content client-side and upload to the platform.
   * The platform pins encrypted blob to IPFS and stores FHE-encrypted key on-chain.
   */
  async uploadEncrypted(content: string, brainId?: string) {
    const { encrypted, key } = encryptContent(content);
    const { high, low } = splitKey(key);

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(encrypted)]), 'brain.enc');
    form.append('keyHigh', Buffer.from(high).toString('hex'));
    form.append('keyLow', Buffer.from(low).toString('hex'));
    if (brainId) form.append('brainId', brainId);

    const res = await fetch(`${this.apiUrl}/upload`, {
      method: 'POST',
      headers: { 'x-wallet-address': this.walletAddress || '', 'x-chain': this.chain },
      body: form,
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json() as Promise<{ brainId: number; estimatedChunks: number }>;
  }
}
