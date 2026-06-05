'use client';

/**
 * usePay — tier-aware payment facade.
 *
 * Single decision point for "buy a paid agent call". The five existing
 * payment hooks (useFherc20Pay, usePayments, useSkillMarketplace, etc.) each
 * solved a slice of the EVM x402 / FHERC20 path; this facade adds the Sui
 * branch *without* duplicating the EVM tree.
 *
 * Decision rule (the "one decision point per concern"):
 *
 *   tier === 'trustless' → Sui-USDC rail (sponsored by platform service wallet)
 *   tier === 'standard'  → existing EVM x402 rail (handled by callers)
 *
 * SOLID:
 *  - SRP: rail selection + delegation only. Each rail's signing logic stays
 *    in its specialized hook/adapter.
 *  - DIP: callers see `pay(challenge)` — they don't know which rail won.
 *  - OCP: a 4th rail = a new branch in the switch + a new adapter; this
 *    file's call sites in `useChat`, `usePayments` etc. don't change.
 *
 * NOTE: the mock-first PayRouter in @fhe-ai-context/sdk already handles the
 * sui_usdc adapter for *server-side* callers. This hook wires the *frontend*
 * Sui wallet for client-side signing, and falls through to the existing EVM
 * payment path when on the standard tier.
 */

import { useCallback } from 'react';
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { type PaymentChallenge, type PaymentReceipt } from '@fhe-ai-context/sdk';
import { useNetwork } from './useNetwork';
import { AGENT_BACKEND_URL } from '@/lib/contracts';

interface PayResult {
  receipt?: PaymentReceipt;
  rail: 'standard' | 'sui_usdc' | 'unhandled';
  /** Caller continues with their own EVM flow when rail === 'standard'. */
  proceedWithEvm?: boolean;
  error?: string;
}

export function usePay() {
  const { network } = useNetwork();
  const suiAccount = useCurrentAccount();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const pay = useCallback(
    async (challenge: PaymentChallenge | null): Promise<PayResult> => {
      // Standard tier: caller handles EVM x402 / FHERC20 themselves.
      if (network.tier === 'standard') {
        return { rail: 'standard', proceedWithEvm: true };
      }

      // Trustless tier: pick the sui_usdc rail.
      const offer = challenge?.rails.find((r) => r.rail === 'sui_usdc');
      if (!offer) {
        return {
          rail: 'unhandled',
          error: 'Server did not advertise sui_usdc rail in the 402 challenge.',
        };
      }
      if (!suiAccount) {
        return { rail: 'unhandled', error: 'Sui wallet not connected' };
      }

      // The platform sponsors gas (per the testnet-first PRD decision).
      // The actual USDC transfer is signed by the user; the platform
      // co-signs as gas owner, then broadcasts. The server endpoint
      // /v3/identity/sponsor accepts the user-signed bytes and returns
      // the gas-co-signed digest. Frontend code-path remains thin.
      try {
        const tx = new Transaction();
        tx.setSender(suiAccount.address);
        // Move call shape mirrors what the server's sui-sdk expects.
        tx.moveCall({
          target: `${process.env.NEXT_PUBLIC_SUI_PAY_PACKAGE ?? '0x0'}::pay::pay_usdc`,
          arguments: [tx.pure.u64(BigInt(Math.round(parseFloat(offer.amount_usdc) * 1_000_000)))],
        });

        const result = await signAndExecute({
          // Cast: dapp-kit's wallet-standard pulls a separate @mysten/sui;
          // the Transaction shape is structurally identical, but TS sees
          // them as nominally different types. Validated at runtime.
          transaction: tx as unknown as Parameters<typeof signAndExecute>[0]['transaction'],
          chain: 'sui:testnet',
        });

        const receipt: PaymentReceipt = {
          rail: 'sui_usdc',
          tx_or_receipt: result.digest,
          amount_usdc: offer.amount_usdc,
          ts: Date.now(),
        };
        return { rail: 'sui_usdc', receipt };
      } catch (err) {
        return { rail: 'sui_usdc', error: (err as Error).message };
      }
    },
    [network.tier, suiAccount, signAndExecute],
  );

  return {
    pay,
    /** Convenience flag for callers that branch UI on the active tier. */
    isTrustless: network.tier === 'trustless',
    apiUrl: AGENT_BACKEND_URL,
  };
}
