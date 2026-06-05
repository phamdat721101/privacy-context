'use client';

/**
 * useActiveWallet — single source of truth for "the user's wallet on the
 * currently selected network".
 *
 * Why this hook exists
 * --------------------
 * Before this file landed, every Sui-only page (`/train`, `/marketplace/[id]`,
 * `/dashboard/mcp`, `/dashboard/costs`, `/account/memwal/*`) was reading the
 * wallet address via `useAccount()` from wagmi — an EVM-only hook. When a
 * user switches to the Sui network and connects only a Sui wallet via
 * dapp-kit, the wagmi address is `undefined` and the page silently breaks
 * (e.g. the Train button stays disabled forever even after the user fills
 * the form).
 *
 * SOLID
 * -----
 *  - SRP: one hook, one job — return the address that matches the active
 *    network's wallet kind.
 *  - DIP: pages depend on this hook, never on `useAccount()` or
 *    `useCurrentAccount()` directly.
 *  - OCP: adding a third wallet family = one branch here.
 *
 * Usage
 * -----
 *   const { address, kind, isReady } = useActiveWallet();
 *   if (!isReady) return <Spinner />;
 *   if (!address) return <ConnectWalletPrompt />;
 *   // address is now the Sui address on Sui networks, EVM address on EVM networks.
 */

import { useAccount } from 'wagmi';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useNetwork } from './useNetwork';
import { isSuiNetwork } from '@/lib/networks';

export interface ActiveWallet {
  /** The address for the active network's wallet kind, or `undefined` if none. */
  address: string | undefined;
  /** Which wallet ecosystem produced the address. */
  kind: 'sui' | 'evm';
  /** `true` after `useNetwork()` hydration completes — gate UI on this to avoid SSR flicker. */
  isReady: boolean;
}

export function useActiveWallet(): ActiveWallet {
  const { network, ready } = useNetwork();
  const evm = useAccount();
  const sui = useCurrentAccount();
  const onSui = isSuiNetwork(network);

  return {
    address: onSui ? sui?.address : evm.address,
    kind: onSui ? 'sui' : 'evm',
    isReady: ready,
  };
}
