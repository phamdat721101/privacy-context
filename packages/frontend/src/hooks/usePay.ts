'use client';

/**
 * usePay — payment facade. Single-chain post-Sui-removal: every challenge
 * is resolved via the EVM x402 / FHERC20 path the caller already owns
 * (useChat, useFherc20Pay, the buyer-side fetch loop).
 *
 * Kept as a hook so existing call sites compile; the Sui-USDC branch this
 * facade used to dispatch is gone with the Sui surface.
 */

import { useCallback } from 'react';
import { type PaymentChallenge, type PaymentReceipt } from '@fhe-ai-context/sdk';
import { AGENT_BACKEND_URL } from '@/lib/contracts';

interface PayResult {
  receipt?: PaymentReceipt;
  rail: 'standard' | 'unhandled';
  /** Caller continues with their own EVM flow when rail === 'standard'. */
  proceedWithEvm?: boolean;
  error?: string;
}

export function usePay() {
  const pay = useCallback(
    async (_challenge: PaymentChallenge | null): Promise<PayResult> => {
      // Single-chain: caller handles EVM x402 / FHERC20 themselves.
      return { rail: 'standard', proceedWithEvm: true };
    },
    [],
  );

  return {
    pay,
    isTrustless: false,
    apiUrl: AGENT_BACKEND_URL,
  };
}
