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
import { usePrivy, useWallets, type ConnectedWallet } from '@privy-io/react-auth';
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

/**
 * usePrivyEvmWallet — returns the user's currently-connected EVM
 * `ConnectedWallet` from Privy, or `undefined` when no EVM wallet is
 * active. The returned object exposes `.address`, `.switchChain()` and
 * `.getEthereumProvider()` — everything a viem `WalletClient` needs.
 *
 * Why this exists: callers that need to *sign* (mint a permit, send a
 * tx) used to do `useWallets()[0]` blindly. That breaks in two ways:
 *   1. `wallets[0]` may be a *Solana* wallet, not the EVM one.
 *   2. `wallets[]` is empty for the first few render cycles even when
 *      a wallet is connected upstream via wagmi.
 *
 * Filtering by `type === 'ethereum'` resolves both. The hook is a thin
 * primitive; SOLID-wise it owns "the EVM wallet object" exactly once.
 */
export function usePrivyEvmWallet(): ConnectedWallet | undefined {
  const { wallets } = useWallets();
  return wallets.find((w) => w.type === 'ethereum');
}

/**
 * usePrivyEvmAddress — single source of truth for "the user's EVM address,
 * regardless of how they signed in".
 *
 * Privy exposes a connected wallet via two surfaces that don't always agree:
 *   - `usePrivy().user.wallet.address` is populated only for *embedded*
 *     wallets (created when `createOnLogin: 'users-without-wallets'` fires).
 *   - `useWallets().wallets[]` lists every connected wallet — embedded or
 *     external (MetaMask, WalletConnect, Coinbase) — with a `type` field.
 *
 * Reading `user.wallet.address` alone is the bug pattern: users who signed
 * in via the `'wallet'` loginMethod see their nav pill render correctly
 * (because `useActiveWallet` already falls back through wagmi's
 * `useAccount()`), but any page that bypasses this hook reads `undefined`
 * and renders "wallet not connected" while the user clearly is connected.
 *
 * SOLID:
 *   - SRP: one hook, one job — return an EVM address or `undefined`.
 *   - DIP: pages depend on this hook; no page reaches into Privy's user
 *     object directly to derive a wallet address.
 *   - I3: the resolution rule lives here. `useActiveWallet` consumes it
 *     for the EVM branch so the two hooks never diverge.
 */
export function usePrivyEvmAddress(): `0x${string}` | undefined {
  const evmWallet = usePrivyEvmWallet();
  if (evmWallet?.address) return evmWallet.address as `0x${string}`;

  // Fallback: Privy's session-level wallet, used only when wallets[]
  // hasn't yet hydrated for an embedded-only session. Guards against a
  // Solana embedded wallet leaking into the EVM branch.
  const { user } = usePrivy();
  if (user?.wallet?.chainType === 'ethereum' && user.wallet.address) {
    return user.wallet.address as `0x${string}`;
  }
  return undefined;
}

export function useActiveWallet(): ActiveWallet {
  const { network, ready } = useNetwork();
  const evm = useAccount();
  const sui = useCurrentAccount();
  const onSui = isSuiNetwork(network);

  // EVM address resolution: prefer wagmi (already authenticated to the active
  // chain), then fall back to any connected Privy wallet (embedded OR
  // external). The fallback covers the window after a Sui→EVM network
  // switch where wagmi's connector has not yet hydrated and the case where
  // the user signed in with an external wallet that wagmi has not picked up.
  const privyEvm = usePrivyEvmAddress();
  const evmAddress = evm.address ?? privyEvm;

  return {
    address: onSui ? sui?.address : evmAddress,
    kind: onSui ? 'sui' : 'evm',
    isReady: ready,
  };
}
