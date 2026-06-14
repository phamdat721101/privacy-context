'use client';

/**
 * useActiveWallet — single source of truth for the user's EVM wallet.
 *
 * Single-chain (Arbitrum + Fhenix) post-Sui-removal. The hook keeps its
 * shape — `{ address, kind, isReady }` — so existing call sites compile,
 * but `kind` is always `'evm'`.
 *
 * SOLID:
 *   - SRP: return the user's EVM address (Privy embedded or external).
 *   - DIP: pages depend on this hook, never on `useAccount()` directly.
 */

import { useAccount } from 'wagmi';
import { usePrivy, useWallets, type ConnectedWallet } from '@privy-io/react-auth';

export interface ActiveWallet {
  address: string | undefined;
  kind: 'evm';
  isReady: boolean;
}

/**
 * usePrivyEvmWallet — the user's connected EVM `ConnectedWallet` from
 * Privy, or `undefined` when none. Filters out non-Ethereum wallet types
 * (e.g. Solana embedded wallets).
 */
export function usePrivyEvmWallet(): ConnectedWallet | undefined {
  const { wallets } = useWallets();
  return wallets.find((w) => w.type === 'ethereum');
}

/**
 * usePrivyEvmAddress — the user's EVM address, regardless of how they
 * signed in (embedded magic-link or external wallet).
 */
export function usePrivyEvmAddress(): `0x${string}` | undefined {
  const evmWallet = usePrivyEvmWallet();
  const { user } = usePrivy();

  if (evmWallet?.address) return evmWallet.address as `0x${string}`;
  if (user?.wallet?.chainType === 'ethereum' && user.wallet.address) {
    return user.wallet.address as `0x${string}`;
  }
  return undefined;
}

export function useActiveWallet(): ActiveWallet {
  const evm = useAccount();
  const privyEvm = usePrivyEvmAddress();
  const evmAddress = evm.address ?? privyEvm;

  return {
    address: evmAddress,
    kind: 'evm',
    isReady: true,
  };
}
