'use client';

/**
 * components/NetworkSwitcher.tsx — top-bar chain picker.
 *
 * Renders a compact pill next to the WalletConnect button. Click → dropdown
 * with the networks OpenX supports (Base Sepolia, Arbitrum Sepolia, Sui
 * Testnet). Selection branches on `network.kind`:
 *
 *   - EVM chains use Privy's `wallet.switchChain(id)` (chains are pre-known
 *     to common wallets).
 *   - Sui chains open the dapp-kit `useConnectWallet()` flow if no Sui
 *     wallet is connected; otherwise the persistence is enough.
 *
 * Single source of truth for the *selected key* lives in `hooks/useNetwork`.
 * This component only renders + delegates.
 *
 * SOLID:
 *   - SRP: dropdown UI + delegate. No persistence here.
 *   - DIP: chain literals come from `lib/networks.ts`; switch verbs come
 *     from per-kind adapters.
 *   - OCP: a 4th network kind = a new branch in `switchTo`, nothing else.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrivy, useWallets, type ConnectedWallet } from '@privy-io/react-auth';
import { useConnectWallet, useCurrentWallet, useWallets as useSuiWallets } from '@mysten/dapp-kit';
import {
  SUPPORTED_NETWORKS,
  getNetworkById,
  isEvmNetwork,
  isSuiNetwork,
  type Network,
  type NetworkKey,
} from '@/lib/networks';
import { useNetwork } from '@/hooks/useNetwork';

// ─── helpers ─────────────────────────────────────────────────────────────

/** Parse Privy's CAIP-2 wallet.chainId (e.g. "eip155:421614") → decimal id. */
function parseChainId(caip2OrNumber: string | number | undefined | null): number | undefined {
  if (caip2OrNumber == null) return undefined;
  if (typeof caip2OrNumber === 'number') return caip2OrNumber;
  const tail = caip2OrNumber.split(':').pop() ?? caip2OrNumber;
  const n = Number(tail);
  return Number.isFinite(n) ? n : undefined;
}

// ─── chain switch (per-kind adapter) ─────────────────────────────────────

type SwitchError = 'rejected' | 'no-wallet' | 'no-sui-wallet' | string;

interface SwitchCtx {
  evmWallet: ConnectedWallet | undefined;
  suiConnected: boolean;
  connectSui: () => Promise<void>;
}

async function switchTo(network: Network, ctx: SwitchCtx): Promise<void> {
  if (isEvmNetwork(network)) {
    if (!ctx.evmWallet) throw Object.assign(new Error('no-wallet'), { code: 'no-wallet' });
    await ctx.evmWallet.switchChain(network.id);
    return;
  }
  if (isSuiNetwork(network)) {
    // If a Sui wallet is already connected, persistence + key change is enough.
    // dapp-kit's chain selection lives at the call-site (per-tx) — there's no
    // global "switch Sui chain" verb on a wallet adapter today.
    if (ctx.suiConnected) return;
    await ctx.connectSui();
    return;
  }
}

function classifyError(err: unknown): SwitchError {
  const e = err as { code?: number | string; message?: string };
  if (e.code === 4001 || /user rejected|denied/i.test(e.message ?? '')) return 'rejected';
  if (e.code === 'no-wallet') return 'no-wallet';
  if (e.code === 'no-sui-wallet') return 'no-sui-wallet';
  return e.message ?? 'unknown';
}

// ─── component ───────────────────────────────────────────────────────────

export function NetworkSwitcher() {
  const { authenticated, ready } = usePrivy();
  const { wallets } = useWallets();
  const evmWallet = wallets[0];

  // Sui dapp-kit hooks — present on every render but no-ops when no Sui
  // wallet extension is installed.
  const suiCurrent = useCurrentWallet();
  const suiAvailable = useSuiWallets();
  const { mutateAsync: connectSuiAsync } = useConnectWallet();

  const evmChainId = parseChainId(evmWallet?.chainId);
  const evmNetwork = getNetworkById(evmChainId);

  const { network: selected, networkKey, setNetworkKey, ready: netReady } = useNetwork();

  const [open, setOpen] = useState(false);
  const [pendingKey, setPendingKey] = useState<NetworkKey | null>(null);
  const [error, setError] = useState<SwitchError | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Whenever the user's wallet *actually* settles on a new EVM chain, mirror
  // that into the selected network — keeps the pill honest if they switched
  // chains externally (MetaMask). We only do this when the current selection
  // is itself an EVM network — switching from Sui back to EVM is the user's
  // explicit action, not something we infer.
  useEffect(() => {
    if (!netReady) return;
    if (selected.kind !== 'evm') return;
    if (evmNetwork && evmNetwork.key !== selected.key) {
      setNetworkKey(evmNetwork.key);
    }
  }, [evmNetwork?.key, netReady, selected.kind, selected.key, setNetworkKey]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const onPick = useCallback(
    async (network: Network) => {
      setError(null);
      if (network.key === networkKey && (network.kind === 'evm' ? network.id === evmChainId : suiCurrent.connectionStatus === 'connected')) {
        setOpen(false);
        return;
      }
      setPendingKey(network.key);
      try {
        await switchTo(network, {
          evmWallet,
          suiConnected: suiCurrent.connectionStatus === 'connected',
          connectSui: async () => {
            const wallet = suiAvailable[0];
            if (!wallet) throw Object.assign(new Error('no-sui-wallet'), { code: 'no-sui-wallet' });
            await connectSuiAsync({ wallet });
          },
        });
        // Only persist after the user-facing switch succeeds; otherwise the
        // pill would lie about state (showing Sui while wallet is on EVM).
        setNetworkKey(network.key);
        setOpen(false);
      } catch (err) {
        setError(classifyError(err));
      } finally {
        setPendingKey(null);
      }
    },
    [
      networkKey,
      evmWallet,
      evmChainId,
      suiCurrent.connectionStatus,
      suiAvailable,
      connectSuiAsync,
      setNetworkKey,
    ],
  );

  const pillLabel = useMemo(() => {
    if (!authenticated) return 'Network';
    return selected.shortName;
  }, [authenticated, selected.shortName]);

  const pillIcon = selected.icon;
  const disabled = !ready || !authenticated;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        title={selected.name}
        aria-label={`Switch network. Current: ${selected.name}.`}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-mono transition-colors ${
          disabled
            ? 'cursor-not-allowed border-outline-variant/20 bg-surface-container-low text-on-surface-variant/60'
            : 'border-outline-variant/40 bg-surface-container-high text-on-surface hover:border-primary/40'
        }`}
      >
        <span aria-hidden className="text-[12px] leading-none">{pillIcon}</span>
        <span className="hidden sm:inline">{pillLabel}</span>
        <span className="material-symbols-outlined text-[14px] opacity-70">
          {open ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {open && !disabled && (
        <div
          role="listbox"
          aria-label="Networks"
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-72 overflow-hidden rounded-xl border border-outline-variant/30 bg-surface shadow-xl"
        >
          <div className="border-b border-outline-variant/30 px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">
            switch network
          </div>
          <ul className="py-1">
            {SUPPORTED_NETWORKS.map((n) => {
              const active = n.key === networkKey;
              const pending = pendingKey === n.key;
              const subtitle =
                n.kind === 'evm' ? `${n.featureHint} · chain ${n.id}` : `${n.featureHint} · ${n.suiChain}`;
              return (
                <li key={n.key}>
                  <button
                    type="button"
                    onClick={() => onPick(n)}
                    role="option"
                    aria-selected={active}
                    disabled={pending}
                    className={`flex w-full items-start gap-3 px-3 py-2 text-left text-sm transition-colors ${
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'hover:bg-surface-container-high'
                    }`}
                  >
                    <span aria-hidden className="mt-0.5 text-base leading-none">{n.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 font-medium">
                        {n.name}
                        {active && <span className="material-symbols-outlined text-[14px]">check_circle</span>}
                      </span>
                      <span className="block text-[11px] text-on-surface-variant">{subtitle}</span>
                    </span>
                    {pending && (
                      <span className="material-symbols-outlined animate-spin text-[16px] text-on-surface-variant">
                        progress_activity
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {error && <ErrorRow error={error} onDismiss={() => setError(null)} />}
        </div>
      )}
    </div>
  );
}

function ErrorRow({ error, onDismiss }: { error: SwitchError; onDismiss: () => void }) {
  const message =
    error === 'rejected'
      ? 'Switch declined in your wallet.'
      : error === 'no-wallet'
      ? 'Connect a wallet first.'
      : error === 'no-sui-wallet'
      ? 'No Sui wallet detected. Install Slush, Suiet, or another Sui wallet to use trustless mode.'
      : `Switch failed: ${error}`;
  return (
    <div className="flex items-start gap-2 border-t border-error/30 bg-error/10 px-3 py-2 text-[11px] text-error">
      <span className="material-symbols-outlined text-[14px]">error</span>
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss} className="rounded p-0.5 hover:bg-error/20" aria-label="Dismiss">
        <span className="material-symbols-outlined text-[14px]">close</span>
      </button>
    </div>
  );
}
