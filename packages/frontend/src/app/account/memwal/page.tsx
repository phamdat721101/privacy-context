'use client';

/**
 * /account/memwal — seller-side overview of the user's MemWal account state.
 *
 * Data sources (no new endpoints needed):
 *   - GET /v3/memory/status            (network + peer-dep flag + relayer URL)
 *   - GET /v3/memory/operator/stats    (linked brains + earnings)
 *
 * Sui-only. Single page file, no new shared components.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useActiveWallet } from '@/hooks/useActiveWallet';
import { RequireSuiNetwork } from '@/components/RequireSuiNetwork';
import { AGENT_BACKEND_URL } from '@/lib/contracts';

interface Stats {
  network: string;
  peerDepEnabled: boolean;
  delegatesConfigured: number;
  relayerUrl: string;
  operatorAddress: string | null;
  operatorReady: boolean;
}

interface Earnings {
  total_revenue: string;
  query_count: string;
  last_24h: string;
  operator_amount: string;
}

interface Brain {
  sui_object_id: string;
  title: string;
  namespace: string;
  cognitive_level: number;
  active: boolean;
  price_per_query_usdc: string;
}

export default function AccountMemWalPage() {
  return (
    <RequireSuiNetwork
      title="MemWal account is Sui-only"
      description="Switch to Sui to provision your MemWal account and manage delegate keys."
    >
      <AccountMemWalInner />
    </RequireSuiNetwork>
  );
}

function AccountMemWalInner() {
  const { address } = useActiveWallet();
  const [stats, setStats] = useState<Stats | null>(null);
  const [brains, setBrains] = useState<Brain[]>([]);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) {
      setLoading(false);
      return;
    }
    Promise.all([
      fetch(`${AGENT_BACKEND_URL}/v3/memory/status`).then((r) => r.json()).catch(() => null),
      fetch(`${AGENT_BACKEND_URL}/v3/memory/operator/stats`, {
        headers: { 'x-wallet-address': address, 'x-chain': 'sui' },
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([s, st]) => {
        setStats(s);
        if (st) {
          setBrains(st.brains ?? []);
          setEarnings(st.earnings ?? null);
        }
      })
      .finally(() => setLoading(false));
  }, [address]);

  return (
    <div className="space-y-6">
      <header className="border-b border-outline-variant/30 pb-4">
        <h1 className="font-headline text-2xl font-bold">MemWal account</h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          Manage your Walrus Memory account binding, OpenX-pool delegate keys, and
          storage quota.
        </p>
      </header>

      {!address ? (
        <p className="rounded-lg border border-outline-variant/40 bg-surface-container-low/60 p-6 text-sm text-on-surface-variant">
          Connect a wallet to manage your MemWal account.
        </p>
      ) : loading ? (
        <p className="py-12 text-center text-on-surface-variant">Loading…</p>
      ) : (
        <>
          {/* System status */}
          <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Stat label="Network" value={stats?.network ?? '—'} />
            <Stat
              label="Peer dep"
              value={stats?.peerDepEnabled ? 'enabled' : 'disabled'}
              tone={stats?.peerDepEnabled ? 'ok' : 'warn'}
            />
            <Stat
              label="OpenX operator"
              value={stats?.operatorReady ? 'ready' : 'not configured'}
              tone={stats?.operatorReady ? 'ok' : 'warn'}
              detail={stats?.operatorAddress ?? undefined}
            />
          </section>

          {/* Earnings summary */}
          <section className="rounded-lg border border-outline-variant/40 bg-surface-container-low/60 p-4 backdrop-blur">
            <div className="flex items-center justify-between">
              <h2 className="font-headline text-lg">Earnings</h2>
              <Link
                href="/account/memwal/billing"
                className="text-xs text-primary hover:underline"
              >
                full breakdown →
              </Link>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat
                label="Total revenue"
                value={`$${Number(earnings?.total_revenue ?? '0').toFixed(4)}`}
              />
              <Stat label="Total queries" value={earnings?.query_count ?? '0'} />
              <Stat label="Last 24h" value={earnings?.last_24h ?? '0'} />
              <Stat
                label="OpenX cut"
                value={`$${Number(earnings?.operator_amount ?? '0').toFixed(4)}`}
              />
            </div>
          </section>

          {/* Brains list */}
          <section>
            <div className="flex items-center justify-between">
              <h2 className="font-headline text-lg">Your brains</h2>
              <Link
                href="/train"
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-on-primary"
              >
                + Train new
              </Link>
            </div>
            {brains.length === 0 ? (
              <p className="mt-3 rounded-lg border border-outline-variant/40 bg-surface-container-low/60 p-4 text-sm text-on-surface-variant">
                No published brains yet. <Link href="/train" className="text-primary hover:underline">Train one →</Link>
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-outline-variant/30 rounded-lg border border-outline-variant/40 bg-surface-container-low/60">
                {brains.map((b) => (
                  <li key={b.sui_object_id}>
                    <Link
                      href={`/marketplace/${b.sui_object_id}`}
                      className="grid grid-cols-1 gap-2 p-4 transition hover:bg-primary/5 md:grid-cols-[2fr_1fr_1fr_auto]"
                    >
                      <div>
                        <p className="font-headline text-sm text-on-surface line-clamp-1">{b.title}</p>
                        <p className="font-mono text-[11px] text-outline">{b.namespace}</p>
                      </div>
                      <span className="font-mono text-xs text-on-surface-variant">L{b.cognitive_level}</span>
                      <span className="font-mono text-xs text-primary">
                        ${Number(b.price_per_query_usdc).toFixed(4)}
                      </span>
                      <span
                        className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                          b.active
                            ? 'border-secondary/30 bg-secondary/5 text-secondary'
                            : 'border-outline/30 bg-outline/5 text-outline'
                        }`}
                      >
                        {b.active ? 'live' : 'paused'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  detail,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn';
  detail?: string;
}) {
  const cls = tone === 'ok' ? 'text-secondary' : tone === 'warn' ? 'text-amber-300' : 'text-primary';
  return (
    <div className="rounded-lg border border-outline-variant/40 bg-surface-container-low/60 p-4 backdrop-blur">
      <p className="font-mono text-[10px] uppercase tracking-widest text-outline">{label}</p>
      <p className={`mt-1 font-headline text-lg ${cls}`}>{value}</p>
      {detail && <p className="font-mono text-[10px] text-on-surface-variant truncate" title={detail}>{detail}</p>}
    </div>
  );
}
