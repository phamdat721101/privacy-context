'use client';

/**
 * useCredits — read the buyer's credit balance from the API.
 *
 * Per PRD-G. Mirrors useUsdcBalance shape (`display`, `isLow`, `refetch`).
 * The /v3/credits/me endpoint is auth-gated, so this hook is only useful
 * when the user is signed in via Privy.
 *
 * SOLID:
 *   - SRP: this hook reads + caches the balance. Top-up + spend live
 *     elsewhere (TopUpModal + the n-payment client invoked by /agent run).
 */

import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import { usePrivyEvmAddress } from '@/hooks/useActiveWallet';

interface CreditMe {
  wallet: string;
  balance_usdc: string;
  welcome_granted: boolean;
  privy_bound: boolean;
}

export interface CreditsState {
  balance: number | null;
  display: string;
  welcomeGranted: boolean;
  isLow: boolean;
  loading: boolean;
  enabled: boolean;          // false → backend reports 404 (flag off)
  refetch: () => Promise<void>;
}

const LOW_THRESHOLD = 1; // < $1 → prompt top-up on next hire

export function useCredits(lowThreshold = LOW_THRESHOLD): CreditsState {
  const { authenticated, getAccessToken } = usePrivy();
  const wallet = usePrivyEvmAddress();

  const [balance, setBalance] = useState<number | null>(null);
  const [welcomeGranted, setWelcomeGranted] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!authenticated || !wallet) {
      setBalance(null);
      return;
    }
    setLoading(true);
    try {
      const token = await getAccessToken().catch(() => null);
      const headers: HeadersInit = { 'x-wallet-address': wallet };
      if (token) headers['authorization'] = `Bearer ${token}`;
      const r = await fetch(`${AGENT_BACKEND_URL}/v3/credits/me`, { headers });
      if (r.status === 404) {
        setEnabled(false);
        return;
      }
      if (!r.ok) return;
      const j = (await r.json()) as CreditMe;
      setBalance(Number(j.balance_usdc));
      setWelcomeGranted(j.welcome_granted);
      setEnabled(true);
    } finally {
      setLoading(false);
    }
  }, [authenticated, wallet, getAccessToken]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return {
    balance,
    display: balance === null ? '—' : `$${balance.toFixed(2)}`,
    welcomeGranted,
    isLow: balance !== null && balance < lowThreshold,
    loading,
    enabled,
    refetch,
  };
}
