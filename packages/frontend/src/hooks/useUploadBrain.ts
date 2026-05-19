'use client';
import { useState, useCallback } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { useFheClient } from './useFheClient';
import { BRAIN_KEY_VAULT_ADDRESS, AGENT_BACKEND_URL } from '@/lib/contracts';

// V2 vault ABI — minimal surface needed
const VAULT_V2_ABI = [
  'function storeKey(uint256 brainId, (bytes32 data, int32 securityZone, bytes signature) high, (bytes32 data, int32 securityZone, bytes signature) low)',
] as const;

export type UploadStep = 'idle' | 'encrypting' | 'wrapping-key' | 'storing-key' | 'uploading' | 'done' | 'error';

/**
 * useUploadBrain — full v2 upload pipeline.
 *
 * Flow:
 *   1. AES-256-GCM encrypt content in browser (Web Crypto API)
 *   2. Split AES key → 2x bigint (high/low, 16 bytes each)
 *   3. cofheClient.encryptInputs([Encryptable.uint128(high), Encryptable.uint128(low)])
 *   4. BrainKeyVaultV2.storeKey(brainId, eHigh, eLow) — user signs tx
 *   5. POST /v2/upload with opaque ciphertext
 */
export function useUploadBrain() {
  const { client, ensurePermit } = useFheClient();
  const { wallets } = useWallets();
  const [step, setStep] = useState<UploadStep>('idle');
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(async (content: string, brainId?: number) => {
    setError(null);
    try {
      if (!client) throw new Error('FHE client not ready');
      const wallet = wallets[0];
      if (!wallet) throw new Error('No wallet connected');

      // Step 1: AES-256-GCM encrypt
      setStep('encrypting');
      const key = crypto.getRandomValues(new Uint8Array(32));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
      const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, new TextEncoder().encode(content));
      const ciphertext = btoa(String.fromCharCode(...new Uint8Array(iv), ...new Uint8Array(cipherBuf)));

      // Step 2: Split key into two 128-bit halves as bigint
      setStep('wrapping-key');
      const highBytes = key.slice(0, 16);
      const lowBytes = key.slice(16, 32);
      const toBigInt = (b: Uint8Array) => BigInt('0x' + [...b].map(x => x.toString(16).padStart(2, '0')).join(''));
      const highBig = toBigInt(highBytes);
      const lowBig = toBigInt(lowBytes);

      // Step 3: FHE encrypt the key halves with ZK proof
      const { Encryptable } = await import('@cofhe/sdk');
      const [eHigh, eLow] = await client.encryptInputs([
        Encryptable.uint128(highBig),
        Encryptable.uint128(lowBig),
      ]).execute();

      // Step 4: Store encrypted key on-chain (user pays gas once per brain)
      setStep('storing-key');
      const { createWalletClient, custom } = await import('viem');
      const { arbitrumSepolia } = await import('viem/chains');
      const { getContract } = await import('viem');
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({ chain: arbitrumSepolia, transport: custom(provider) });
      const [account] = await walletClient.getAddresses();

      const bid = brainId ?? 0; // 0 = new brain (contract assigns)
      const txHash = await walletClient.writeContract({
        address: (process.env.NEXT_PUBLIC_BRAIN_KEY_VAULT_V2_ADDRESS ?? BRAIN_KEY_VAULT_ADDRESS) as `0x${string}`,
        abi: [{ name: 'storeKey', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'brainId', type: 'uint256' }, { name: 'high', type: 'tuple', components: [{ name: 'data', type: 'bytes32' }, { name: 'securityZone', type: 'int32' }, { name: 'signature', type: 'bytes' }] }, { name: 'low', type: 'tuple', components: [{ name: 'data', type: 'bytes32' }, { name: 'securityZone', type: 'int32' }, { name: 'signature', type: 'bytes' }] }], outputs: [] }],
        functionName: 'storeKey',
        args: [BigInt(bid), eHigh, eLow],
        account,
      });

      // Step 5: Upload opaque ciphertext to API
      setStep('uploading');
      const res = await fetch(`${AGENT_BACKEND_URL}/v2/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-wallet-address': account },
        body: JSON.stringify({ brainId: bid || undefined, ciphertext, txHash }),
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const result = await res.json();

      setStep('done');
      return result;
    } catch (e: any) {
      setError(e.message);
      setStep('error');
      throw e;
    }
  }, [client, wallets, ensurePermit]);

  return { upload, step, error };
}
