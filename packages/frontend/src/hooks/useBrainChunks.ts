'use client';
import { useState, useCallback } from 'react';
import { useFheClient } from './useFheClient';
import { BRAIN_KEY_VAULT_ADDRESS, AGENT_BACKEND_URL } from '@/lib/contracts';

/**
 * useBrainChunks — browser-side decrypt pipeline (GASLESS via decryptForView).
 *
 * Flow:
 *   1. GET /v2/brains/:id/chunks → opaque ciphertext array
 *   2. Read BrainKeyVaultV2.getKeyHandles(brainId) → bytes32 high/low handles
 *   3. cofheClient.decryptForView(highHandle, FheTypes.Uint128) → bigint
 *   4. Reconstruct 32-byte AES key from two 128-bit halves
 *   5. AES-GCM decrypt each chunk in browser
 *   6. TF-IDF rank against question, return top-K
 */
export function useBrainChunks() {
  const { client, ensurePermit } = useFheClient();
  const [loading, setLoading] = useState(false);

  const decryptAndRank = useCallback(async (brainId: number, question: string, topK = 5) => {
    if (!client) throw new Error('FHE client not ready');
    setLoading(true);

    try {
      await ensurePermit();

      // 1. Fetch opaque chunks
      const res = await fetch(`${AGENT_BACKEND_URL}/v2/brains/${brainId}/chunks`);
      if (!res.ok) throw new Error(`Fetch chunks failed: ${res.status}`);
      const chunks: Array<{ chunk_index: number; ciphertext: string }> = await res.json();
      if (!chunks.length) return { plaintexts: [], topK: [] };

      // 2. Get key handles from on-chain
      const { createPublicClient, http } = await import('viem');
      const { arbitrumSepolia } = await import('viem/chains');
      const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http() });
      const vaultAddr = (process.env.NEXT_PUBLIC_BRAIN_KEY_VAULT_V2_ADDRESS ?? BRAIN_KEY_VAULT_ADDRESS) as `0x${string}`;

      const [highHandle, lowHandle] = await publicClient.readContract({
        address: vaultAddr,
        abi: [{ name: 'getKeyHandles', type: 'function', stateMutability: 'view', inputs: [{ name: 'brainId', type: 'uint256' }], outputs: [{ name: 'high', type: 'bytes32' }, { name: 'low', type: 'bytes32' }] }],
        functionName: 'getKeyHandles',
        args: [BigInt(brainId)],
      }) as [string, string];

      // 3. Decrypt key halves via Threshold Network (GASLESS)
      const { FheTypes } = await import('@cofhe/sdk');
      const highBig: bigint = await client.decryptForView(highHandle, FheTypes.Uint128).execute();
      const lowBig: bigint = await client.decryptForView(lowHandle, FheTypes.Uint128).execute();

      // 4. Reconstruct AES-256 key
      const fromBigInt = (b: bigint) => {
        const hex = b.toString(16).padStart(32, '0');
        return new Uint8Array(hex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
      };
      const aesKey = new Uint8Array([...fromBigInt(highBig), ...fromBigInt(lowBig)]);
      const cryptoKey = await crypto.subtle.importKey('raw', aesKey, 'AES-GCM', false, ['decrypt']);

      // 5. AES-GCM decrypt each chunk
      const plaintexts: string[] = [];
      for (const chunk of chunks) {
        const raw = Uint8Array.from(atob(chunk.ciphertext), c => c.charCodeAt(0));
        const iv = raw.slice(0, 12);
        const ct = raw.slice(12);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ct);
        plaintexts.push(new TextDecoder().decode(plain));
      }

      // 6. TF-IDF rank
      const ranked = tfidfRank(question, plaintexts, topK);
      return { plaintexts, topK: ranked };
    } finally {
      setLoading(false);
    }
  }, [client, ensurePermit]);

  return { decryptAndRank, loading };
}

/** Minimal TF-IDF ranker — ported from packages/api/src/services/rag.ts */
function tfidfRank(query: string, docs: string[], k: number): string[] {
  const qTerms = query.toLowerCase().split(/\W+/).filter(Boolean);
  const scores = docs.map(doc => {
    const dTerms = doc.toLowerCase().split(/\W+/).filter(Boolean);
    const termSet = new Set(dTerms);
    let score = 0;
    for (const t of qTerms) {
      if (termSet.has(t)) {
        const tf = dTerms.filter(d => d === t).length / dTerms.length;
        const idf = Math.log(docs.length / (1 + docs.filter(d => d.toLowerCase().includes(t)).length));
        score += tf * idf;
      }
    }
    return score;
  });
  return scores
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map(x => docs[x.i]);
}
