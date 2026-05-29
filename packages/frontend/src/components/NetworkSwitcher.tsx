'use client';

/**
 * components/NetworkSwitcher.tsx — top-bar chain picker.
 *
 * Renders a compact pill next to the WalletConnect button. Click → dropdown
 * with the networks OpenX supports (Base Sepolia, Arbitrum Sepolia).
 * Selecting a row asks the user's wallet to switch chains via Privy's
 * `wallet.switchChain(id)` — both chains are pre-known to common wallets.
 *
 * Persistence:
 *   - localStorage key `openx:network` remembers the last picked NetworkKey.
 *   - URL param `?network=<key>` overrides on mount.
 *   - On boot, if the wallet's actual chainId differs from the persisted
 *     choice, we *trust the wallet* (don't auto-switch); we only update the
 *     pill UI to match. Auto-switching on mount would be hostile.
 *
 * SOLID:
 *   - SRP: this component owns the pill UI, the dropdown, and the persistence
 *     for the user's *intent*. Actual chain switching delegates to the
 *     wallet's own RPC method.
 *   - DIP: no chain literals. Everything comes from `lib/networks.ts`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrivy, useWallets, type ConnectedWallet } from '@privy-io/react-auth';
import {
  SUPPORTED_NETWORKS,
  getNetworkById,
  type Network,
  type NetworkKey,
} from '@/lib/networks';

const STORAGE_KEY = 'openx:network';
const URL_PARAM = 'network';

// ─── helpers ─────────────────────────────────────────────────────────────

/** Parse Privy's CAIP-2 wallet.chainId (e.g. "eip155:421614") → decimal id. */
function parseChainId(caip2OrNumber: string | number | undefined | null): number | undefined {
  if (caip2OrNumber == null) return undefined;
  if (typeof caip2OrNumber === 'number') return caip2OrNumber;
  const tail = caip2OrNumber.split(':').pop() ?? caip2OrNumber;
  const n = Number(tail);
  return Number.isFinite(n) ? n : undefined;
}

function readPersistedKey(): NetworkKey | null {
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get(URL_PARAM);
    if (isNetworkKey(fromUrl)) return fromUrl;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isNetworkKey(stored)) return stored;
  } catch {
    /* SSR */
  }
  return null;
}

function persistKey(key: NetworkKey) {
  try {
    window.localStorage.setItem(STORAGE_KEY, key);
    const url = new URL(window.location.href);
    url.searchParams.set(URL_PARAM, key);
    window.history.replaceState({}, '', url.toString());
  } catch {
    /* SSR */
  }
}

function isNetworkKey(v: unknown): v is NetworkKey {
  return typeof v === 'string' && SUPPORTED_NETWORKS.some((n) => n.key === v);
}

// ─── chain switch (delegates per network kind) ───────────────────────────

type SwitchError = 'rejected' | 'no-wallet' | string;

async function switchTo(wallet: ConnectedWallet, network: Network): Promise<void> {
  await wallet.switchChain(network.id);
}

function classifyError(err: unknown): SwitchError {
  const e = err as { code?: number; message?: string };
  if (e.code === 4001 || /user rejected|denied/i.test(e.message ?? '')) return 'rejected';
  return e.message ?? 'unknown';
}

// ─── component ───────────────────────────────────────────────────────────

export function NetworkSwitcher() {
  const { authenticated, ready } = usePrivy();
  const { wallets } = useWallets();
  const wallet = wallets[0];

  const walletChainId = parseChainId(wallet?.chainId);
  const walletNetwork = getNetworkById(walletChainId);

  const [open, setOpen] = useState(false);
  const [pendingKey, setPendingKey] = useState<NetworkKey | null>(null);
  const [error, setError] = useState<SwitchError | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // On first mount: rehydrate the persisted choice into the URL so deep
  // links pick up the user's last network. We do NOT auto-switch the wallet.
  useEffect(() => {
    const persisted = readPersistedKey();
    if (persisted) persistKey(persisted);
  }, []);

  // Whenever the wallet's actual chain settles, persist it as the new intent.
  // This keeps the pill UI honest if the user switches chains via MetaMask.
  useEffect(() => {
    if (walletNetwork) persistKey(walletNetwork.key);
  }, [walletNetwork?.key]);

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
      if (!wallet) {
        setError('no-wallet');
        return;
      }
      if (network.id === walletChainId) {
        setOpen(false);
        return;
      }
      setPendingKey(network.key);
      try {
        await switchTo(wallet, network);
        persistKey(network.key);
        setOpen(false);
      } catch (err) {
        setError(classifyError(err));
      } finally {
        setPendingKey(null);
      }
    },
    [wallet, walletChainId],
  );

  const pillLabel = useMemo(() => {
    if (!authenticated) return 'Network';
    if (walletNetwork) return walletNetwork.shortName;
    if (walletChainId) return `Chain ${walletChainId}`;
    return 'Network';
  }, [authenticated, walletNetwork, walletChainId]);

  const pillIcon = walletNetwork?.icon ?? '⚪';
  const disabled = !ready || !authenticated || !wallet;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        title={walletNetwork?.name ?? 'Connect a wallet to switch networks'}
        aria-label={`Switch network. Current: ${walletNetwork?.name ?? 'unknown'}.`}
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
              const active = n.id === walletChainId;
              const pending = pendingKey === n.key;
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
                      <span className="block text-[11px] text-on-surface-variant">
                        {n.featureHint} · chain {n.id}
                      </span>
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
