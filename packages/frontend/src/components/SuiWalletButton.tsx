'use client';

/**
 * components/SuiWalletButton.tsx — top-bar Sui wallet connect/disconnect pill.
 *
 * Renders only when the active network is a Sui chain. Mirrors the existing
 * EVM `WalletConnect` pill so the two wallet stacks have visual parity.
 *
 * SOLID:
 *  - SRP: connect/disconnect + truncated address display. No persistence,
 *    no chain switching. Network selection is owned by `NetworkSwitcher`.
 *  - DIP: dapp-kit's hooks are the only Sui surface this file knows about.
 */

import {
  useCurrentAccount,
  useCurrentWallet,
  useDisconnectWallet,
  useConnectWallet,
  useWallets,
} from '@mysten/dapp-kit';
import { useNetwork } from '@/hooks/useNetwork';
import { isSuiNetwork } from '@/lib/networks';

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function SuiWalletButton() {
  const { network } = useNetwork();
  const current = useCurrentWallet();
  const account = useCurrentAccount();
  const wallets = useWallets();
  const { mutate: connectAsync, isPending: connecting } = useConnectWallet();
  const { mutate: disconnect } = useDisconnectWallet();

  // Only render on Sui networks — keeps the top bar uncluttered on EVM.
  if (!isSuiNetwork(network)) return null;

  if (current.connectionStatus === 'connected' && account) {
    return (
      <button
        type="button"
        onClick={() => disconnect()}
        title={account.address}
        className="flex items-center gap-1.5 rounded-full border border-outline-variant/40 bg-surface-container-high px-3 py-1.5 text-xs font-mono text-on-surface hover:border-error/40 hover:text-error"
      >
        <span aria-hidden>🟣</span>
        <span>{shortAddr(account.address)}</span>
        <span className="material-symbols-outlined text-[14px] opacity-60">logout</span>
      </button>
    );
  }

  const noWallets = wallets.length === 0;

  return (
    <button
      type="button"
      onClick={() => {
        if (noWallets) return;
        connectAsync({ wallet: wallets[0] });
      }}
      disabled={connecting || noWallets}
      title={
        noWallets
          ? 'Install Slush, Suiet, or another Sui wallet to use trustless mode'
          : 'Connect Sui wallet'
      }
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-mono transition-colors ${
        connecting || noWallets
          ? 'cursor-not-allowed border-outline-variant/20 bg-surface-container-low text-on-surface-variant/60'
          : 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
      }`}
    >
      <span aria-hidden>🟣</span>
      <span>{noWallets ? 'No Sui wallet' : connecting ? 'Connecting…' : 'Connect Sui'}</span>
    </button>
  );
}
