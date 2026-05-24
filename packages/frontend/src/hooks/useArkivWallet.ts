'use client';

/**
 * hooks/useArkivWallet.ts — sovereign-tier wallet state + write submitter.
 *
 * Single source of truth for: who's connected, what's their GLM balance,
 * are they ready to write, what's the last error. Wraps the write submitter
 * so components don't touch the Arkiv SDK directly.
 *
 * SOLID:
 * - SRP: state + submission for *user-paid* writes only. Reads come from
 *   lib/arkiv.ts; platform-paid writes never enter this hook.
 * - LSP: the submit() function returns the same shape as the server-side
 *   writeLearned() — { entityKey, txHash } — so demo scripts and UI consume
 *   one contract regardless of who paid for gas.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { getArkivPublicClient } from '@/lib/arkiv';
import { getArkivWalletClient, ARKIV_BRAGA_FAUCET } from '@/lib/arkivBrowserClient';
import {
  buildSigningMessage,
  toEntityInput,
  DEFAULT_TTL_SECONDS,
  type LearnedFact,
} from '@fhe-ai-context/sdk';
import type { Hex } from 'viem';
import { keccak256, toBytes } from 'viem';

/** Minimum GLM (in wei) for the user to credibly sign a createEntity tx. */
const FAUCET_THRESHOLD_WEI = 100_000_000_000_000n; // 0.0001 GLM

export type SovereignError =
  | { code: 'no-wallet' }
  | { code: 'chain-add-rejected' }
  | { code: 'low-balance'; faucetUrl: string }
  | { code: 'sign-rejected' }
  | { code: 'rpc'; message: string };

export interface SovereignSubmitInput {
  /** The fact text — minimum 5 chars, maximum 4000. */
  fact: string;
  /** Topic free text — auto-hashed to 16-hex Arkiv attribute. */
  topic: string;
  /** Optional source brain id (defaults to 0 for user-authored memories). */
  sourceBrainId?: number;
  /** Optional confidence 0..100 (defaults to 90 for self-authored). */
  confidence?: number;
}

export interface UseArkivWallet {
  ready: boolean;
  address: Hex | null;
  balanceWei: bigint;
  needsFaucet: boolean;
  faucetUrl: string;
  submitting: boolean;
  error: SovereignError | null;
  /** Refresh the GLM balance manually (useful after faucet visit). */
  refreshBalance: () => Promise<void>;
  /** Sign + send a createEntity tx as the connected user. */
  submit: (input: SovereignSubmitInput) => Promise<{ entityKey: string; txHash: string } | null>;
}

export function useArkivWallet(): UseArkivWallet {
  const { wallets } = useWallets();
  const wallet = wallets[0];
  const address = (wallet?.address as Hex | undefined) ?? null;

  const [balanceWei, setBalanceWei] = useState<bigint>(0n);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<SovereignError | null>(null);

  const refreshBalance = useCallback(async () => {
    if (!address) return;
    try {
      const reader = getArkivPublicClient() as unknown as { getBalance: (a: { address: Hex }) => Promise<bigint> };
      const bal = await reader.getBalance({ address });
      setBalanceWei(bal);
    } catch (err) {
      // Non-fatal: keep the last-known balance.
      // eslint-disable-next-line no-console
      console.warn('useArkivWallet: balance probe failed', (err as Error).message);
    }
  }, [address]);

  // Initial balance probe + 30s refresh while mounted.
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!address) return;
    void refreshBalance();
    ticker.current = setInterval(() => void refreshBalance(), 30_000);
    return () => { if (ticker.current) clearInterval(ticker.current); };
  }, [address, refreshBalance]);

  const submit = useCallback(
    async (input: SovereignSubmitInput): Promise<{ entityKey: string; txHash: string } | null> => {
      if (!wallet || !address) {
        setError({ code: 'no-wallet' });
        return null;
      }
      if (balanceWei < FAUCET_THRESHOLD_WEI) {
        setError({ code: 'low-balance', faucetUrl: ARKIV_BRAGA_FAUCET });
        return null;
      }
      setSubmitting(true);
      setError(null);
      try {
        // 1. Get the wallet client (auto-prompts wallet_addEthereumChain if needed).
        const walletClient = (await getArkivWalletClient(wallet)) as unknown as {
          createEntity: (i: { payload: Uint8Array; contentType: string; attributes: Array<{ key: string; value: string | number }>; expiresIn: number }) => Promise<{ entityKey: string; txHash: string }>;
          signMessage: (a: { message: string }) => Promise<Hex>;
        };

        // 2. Build canonical body, sign off-chain via the same wallet (no gas).
        const topicHash = keccak256(toBytes(input.topic.toLowerCase().trim() || 'general')).slice(2, 18);
        const unsigned: Omit<LearnedFact, 'signature'> = {
          fact: input.fact,
          source: { brainId: input.sourceBrainId ?? 0, queryHash: keccak256(toBytes(input.fact)).slice(2, 18) },
          confidence: input.confidence ?? 90,
          derivedAt: Date.now(),
          signer: address,
        };
        const signature = await walletClient.signMessage({ message: buildSigningMessage(unsigned) });
        const fact: LearnedFact = { ...unsigned, signature };

        // 3. Build entity input + send the on-chain createEntity tx.
        const entityInput = toEntityInput(fact, {
          project: process.env.NEXT_PUBLIC_ARKIV_PROJECT_ATTRIBUTE ?? 'fhedin-ethns-2c4f9a',
          topic: topicHash,
          expiresInSeconds: DEFAULT_TTL_SECONDS,
        });
        const result = await walletClient.createEntity({
          payload: entityInput.payload,
          contentType: entityInput.contentType,
          attributes: entityInput.attributes,
          expiresIn: entityInput.expiresIn,
        });

        // 4. Refresh balance asynchronously so the next save sees the gas spend.
        void refreshBalance();
        return result;
      } catch (err) {
        const e = err as Error & { code?: number; message: string };
        if (e.message === 'user-rejected-chain-add' || e.message === 'user-rejected-chain-switch') {
          setError({ code: 'chain-add-rejected' });
        } else if (e.code === 4001 || /user rejected|denied/i.test(e.message)) {
          setError({ code: 'sign-rejected' });
        } else {
          setError({ code: 'rpc', message: e.message ?? 'unknown' });
        }
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [wallet, address, balanceWei, refreshBalance],
  );

  return {
    ready: !!wallet && !!address,
    address,
    balanceWei,
    needsFaucet: !!address && balanceWei < FAUCET_THRESHOLD_WEI,
    faucetUrl: ARKIV_BRAGA_FAUCET,
    submitting,
    error,
    refreshBalance,
    submit,
  };
}
