'use client';
import { useState, useCallback } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { useFheClient } from './useFheClient';
import { BRAIN_KEY_VAULT_ADDRESS, AGENT_BACKEND_URL } from '@/lib/contracts';
import { createLogger, logStep } from '@/lib/clientLogger';

const log = createLogger('useUploadBrain');

export type UploadStep =
  | 'idle' | 'encrypting' | 'wrapping-key' | 'storing-key' | 'uploading' | 'done' | 'error';

export interface PublishMeta {
  title: string;
  description?: string;
  tags?: string[];
}

/**
 * Coerce the cofhe SDK return shape into a 2-tuple. The SDK has changed
 * shapes across versions; this defensive helper accepts:
 *   - direct array  [a, b]
 *   - { data: [a, b] }
 *   - { handles: [a, b] }
 *   - { items: [a, b] }
 * If none match → throw with a clear message (root cause of the
 * "Cannot read properties of undefined (reading 'length')" bug).
 */
function toPair<T>(v: unknown): [T, T] {
  if (Array.isArray(v) && v.length >= 2) return [v[0] as T, v[1] as T];
  const o = v as any;
  for (const k of ['data', 'handles', 'items', 'result']) {
    if (Array.isArray(o?.[k]) && o[k].length >= 2) return [o[k][0], o[k][1]];
  }
  throw new Error(
    `cofhe.encryptInputs returned an unexpected shape; expected 2-tuple. ` +
    `Got: ${typeof v === 'object' ? JSON.stringify(Object.keys(o ?? {})) : typeof v}`,
  );
}

/** BrainKeyVaultV2.storeKey expects (bytes32 data, int32 securityZone, bytes signature).
 * The cofhe SDK's EncryptedItemInput is { ctHash:bigint, securityZone, utype, signature }.
 * This adapter maps SDK -> contract tuple so viem encodes correctly.
 */
function toContractTuple(x: any): { data: `0x${string}`; securityZone: number; signature: `0x${string}` } | null {
  if (!x || typeof x !== 'object') return null;
  // bigint ctHash → 0x-prefixed 32-byte hex (bytes32).
  let dataHex: string | null = null;
  if (typeof x.ctHash === 'bigint') {
    dataHex = '0x' + x.ctHash.toString(16).padStart(64, '0');
  } else if (typeof x.data === 'string' && x.data.startsWith('0x')) {
    dataHex = x.data; // older SDK shape — still accept
  }
  if (!dataHex) return null;
  const sig = typeof x.signature === 'string' && x.signature.startsWith('0x') ? x.signature : null;
  if (!sig) return null;
  const sz = Number.isInteger(x.securityZone) ? x.securityZone : 0;
  return { data: dataHex as `0x${string}`, securityZone: sz, signature: sig as `0x${string}` };
}

export function useUploadBrain() {
  const { client, ready, error: fheError } = useFheClient();
  const { wallets } = useWallets();
  const [step, setStep] = useState<UploadStep>('idle');
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (content: string, brainId?: number, publishMeta?: PublishMeta) => {
      setError(null);
      const flow = log.child(`flow-${Date.now().toString(36)}`);
      flow.info('start', {
        contentLen: content?.length ?? 0,
        brainId,
        hasPublishMeta: !!publishMeta,
      });

      try {
        // ---- preflight ---------------------------------------------------
        if (!content || !content.trim()) throw new Error('Content is empty.');
        if (!wallets || wallets.length === 0) {
          throw new Error('No wallet connected. Sign in first.');
        }
        const wallet = wallets[0];
        if (!client) {
          throw new Error(
            ready
              ? 'FHE client not connected — try refreshing the page.'
              : fheError
                ? `FHE client error: ${fheError}`
                : 'FHE client still initializing. Wait a few seconds and try again.',
          );
        }

        // ---- 1. AES-256-GCM encrypt -------------------------------------
        setStep('encrypting');
        const enc = await logStep(flow, 'aes-encrypt', async () => {
          const key = crypto.getRandomValues(new Uint8Array(32));
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
          const cipherBuf = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            cryptoKey,
            new TextEncoder().encode(content),
          );
          const b64 = btoa(
            String.fromCharCode(...new Uint8Array(iv), ...new Uint8Array(cipherBuf)),
          );
          return { b64, key };
        }, { contentLen: content.length });

        // ---- 2. Split key + FHE-wrap (defensive shape handling) ---------
        setStep('wrapping-key');
        const [eHigh, eLow] = await logStep(flow, 'fhe-wrap', async () => {
          const key = enc.key;
          const toBigInt = (b: Uint8Array) =>
            BigInt('0x' + [...b].map((x) => x.toString(16).padStart(2, '0')).join(''));
          const highBig = toBigInt(key.slice(0, 16));
          const lowBig = toBigInt(key.slice(16, 32));

          const { Encryptable } = await import('@cofhe/sdk');
          if (typeof Encryptable?.uint128 !== 'function') {
            throw new Error('cofhe SDK is missing Encryptable.uint128 — version mismatch?');
          }
          const raw = await client
            .encryptInputs([Encryptable.uint128(highBig), Encryptable.uint128(lowBig)])
            .execute();
          flow.info('fhe-wrap:result-shape', {
            isArray: Array.isArray(raw),
            keys: raw && typeof raw === 'object' ? Object.keys(raw as any) : null,
          });
          const [a, b] = toPair<any>(raw);
          const eHigh = toContractTuple(a);
          const eLow = toContractTuple(b);
          if (!eHigh || !eLow) {
            throw new Error(
              `cofhe encryptInputs returned unexpected element shape. ` +
              `First element keys: ${Object.keys(a ?? {}).join(',')}. ` +
              `Need ctHash (bigint) + signature (0x…).`,
            );
          }
          flow.info('fhe-wrap:mapped', {
            highData: eHigh.data.slice(0, 10) + '…',
            lowData: eLow.data.slice(0, 10) + '…',
            securityZone: eHigh.securityZone,
          });
          return [eHigh, eLow] as const;
        });

        // ---- 3. Store wrapped key on-chain ------------------------------
        setStep('storing-key');
        const { account, txHash } = await logStep(flow, 'storeKey-tx', async () => {
          const { createWalletClient, custom } = await import('viem');
          const { arbitrumSepolia } = await import('viem/chains');
          const provider = await wallet.getEthereumProvider();
          const walletClient = createWalletClient({
            chain: arbitrumSepolia,
            transport: custom(provider),
          });
          const [acc] = await walletClient.getAddresses();
          if (!acc) throw new Error('Wallet has no account exposed.');
          const bid = brainId ?? 0;
          const tx = await walletClient.writeContract({
            address: (process.env.NEXT_PUBLIC_BRAIN_KEY_VAULT_V2_ADDRESS ??
              BRAIN_KEY_VAULT_ADDRESS) as `0x${string}`,
            abi: [
              {
                name: 'storeKey',
                type: 'function',
                stateMutability: 'nonpayable',
                inputs: [
                  { name: 'brainId', type: 'uint256' },
                  {
                    name: 'high',
                    type: 'tuple',
                    components: [
                      { name: 'data', type: 'bytes32' },
                      { name: 'securityZone', type: 'int32' },
                      { name: 'signature', type: 'bytes' },
                    ],
                  },
                  {
                    name: 'low',
                    type: 'tuple',
                    components: [
                      { name: 'data', type: 'bytes32' },
                      { name: 'securityZone', type: 'int32' },
                      { name: 'signature', type: 'bytes' },
                    ],
                  },
                ],
                outputs: [],
              },
            ],
            functionName: 'storeKey',
            args: [BigInt(bid), eHigh, eLow],
            account: acc,
          });
          return { account: acc, txHash: tx };
        });

        // ---- 4. Upload opaque ciphertext --------------------------------
        setStep('uploading');
        const result = await logStep(flow, 'upload', async () => {
          const res = await fetch(`${AGENT_BACKEND_URL}/v2/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-wallet-address': account },
            body: JSON.stringify({
              brainId: brainId || undefined,
              ciphertext: enc.b64,
              txHash,
              publishMeta,
            }),
          });
          if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`Upload failed: ${res.status} ${body}`);
          }
          return res.json();
        });

        setStep('done');
        flow.info('done', { brainId: result?.brainId });
        return result;
      } catch (e: any) {
        const message = e?.message || String(e);
        setError(message);
        setStep('error');
        flow.error('flow:failed', e);
        throw e;
      }
    },
    [client, ready, fheError, wallets],
  );

  return { upload, step, error };
}
