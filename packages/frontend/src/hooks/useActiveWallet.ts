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
import { usePrivy, useWallets } from '@privy-io/react-auth';
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
 * usePrivyEvmAddress — single source of truth for "the user's EVM address,
 * regardless of how they signed in".
 *
 * Privy exposes a connected wallet via two surfaces that don't always agree:
 *   - `usePrivy().user.wallet.address` is populated only for *embedded*
 *     wallets (created when `createOnLogin: 'users-without-wallets'` fires).
 *   - `useWallets().wallets[]` lists every connected wallet — embedded or
 *     external (MetaMask, WalletConnect, Coinbase) — with `chainType` tags.
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
  const { user } = usePrivy();
  const { wallets } = useWallets();

  // Prefer the actually-connected wallet (covers external wallets like
  // MetaMask that don't populate `user.wallet`). On wallets[] entries the
  // chain family lives on `type`; on `user.wallet` it's `chainType` —
  // different Privy surfaces, same semantics.
  const evmWallet = wallets.find((w) => w.type === 'ethereum');
  if (evmWallet?.address) return evmWallet.address as `0x${string}`;

  // Fallback: Privy's session-level wallet, only when its chainType is EVM.
  // Guards against a Solana embedded wallet leaking into the EVM branch.
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
