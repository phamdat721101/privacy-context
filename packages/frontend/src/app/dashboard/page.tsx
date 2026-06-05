'use client';

import { useEffect, useState } from 'react';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import { useActiveWallet } from '@/hooks/useActiveWallet';

/**
 * /dashboard — Frame F1 cash-flow proof.
 *
 * Renders live counts from /v3/dashboard/stats. SWR-style polling (30s).
 * Receipts link to Suivision (testnet) for Sui txs; otherwise generic.
 *
 * SOLID:
 *   - SRP: one page, one fetch, three render blocks. No cross-component state.
 */

interface Stats {
  counts: {
    brains_published: number;
    workflows_published: number;
    skills_published: number;
    reflective_published: number;
    workflow_runs_total: number;
    workflow_runs_24h: number;
    total_usdc_routed: string;
    usdc_routed_24h: string;
  };
  topSellers: Array<{ seller: string; earned: string; calls: number }>;
  recentReceipts: Array<{
    slug: string;
    buyer: string;
    amount_usdc: string;
    tx_hash: string;
    network: string;
    method: string;
    created_at: string;
  }>;
  walUsdRate?: { usdPerWal: number; cached: boolean; updatedAt: number };
  generatedAt: string;
}

function explorerUrl(network: string, txHash: string): string | null {
  if (!txHash || txHash.startsWith('mock-') || txHash.startsWith('free-')) return null;
  if (network === 'sui-testnet') return `https://suivision.xyz/txblock/${txHash}?network=testnet`;
  if (network === 'sui-mainnet') return `https://suivision.xyz/txblock/${txHash}`;
  if (network === 'base-sepolia') return `https://sepolia.basescan.org/tx/${txHash}`;
  if (network === 'arbitrum-sepolia') return `https://sepolia.arbiscan.io/tx/${txHash}`;
  return null;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { address } = useActiveWallet();

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      // Endpoint is public-by-design (whitelisted in auth.ts), but we
      // pass the wallet header opportunistically so the dashboard works
      // even on older API builds where the public-path regex hasn't
      // shipped yet (defensive against stale deploys).
      const headers: Record<string, string> = {};
      if (address) headers['x-wallet-address'] = address;
      fetch(`${AGENT_BACKEND_URL}/v3/dashboard/stats`, { headers })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
        .then((j) => !cancelled && setStats(j))
        .catch((e) => !cancelled && setErr(String(e?.message ?? e)));
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [address]);

  if (err && !stats) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="font-headline text-3xl font-bold">Dashboard</h1>
        <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-500">
          Cash-flow stats unavailable: {err}. The /v3/dashboard/stats endpoint may be on an older build.
        </p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="p-6 text-on-surface-variant">Loading cash-flow proof…</div>
    );
  }

  const c = stats.counts;
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="font-headline text-3xl font-bold">Cash-flow dashboard</h1>
        <p className="text-sm text-on-surface-variant">
          Live counts from <code className="rounded bg-surface-container-low px-1">paid_calls</code> · refresh every 30s · last fetch{' '}
          {new Date(stats.generatedAt).toLocaleTimeString()}
        </p>
      </div>

      {/* Top counts — the headline numbers Frame F1 cares about. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Brains" value={c.brains_published} hint="published" />
        <StatCard label="Workflows" value={c.workflows_published} hint="published" />
        <StatCard label="Skills" value={c.skills_published} hint="published" />
        <StatCard label="Reflective traces" value={c.reflective_published} hint="published" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="USDC routed (total)"
          value={`$${Number(c.total_usdc_routed).toFixed(2)}`}
          hint="all-time, all rails"
          accent
        />
        <StatCard
          label="USDC routed (24h)"
          value={`$${Number(c.usdc_routed_24h).toFixed(2)}`}
          hint="last 24 hours"
          accent
        />
        <StatCard
          label="Workflow runs"
          value={`${c.workflow_runs_total} (${c.workflow_runs_24h} in 24h)`}
          hint="executions persisted"
        />
      </div>

      {/* Tatum infrastructure section — surfaces the 3 Tatum products live in OpenX. */}
      {stats.walUsdRate ? (
        <section className="rounded-xl border border-secondary/30 bg-secondary/5 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-secondary">hub</span>
            <h2 className="font-headline text-base font-semibold">Powered by Tatum</h2>
            <span className="ml-auto rounded-full bg-secondary/10 px-2 py-0.5 font-mono text-[10px] uppercase text-secondary">
              live
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label="WAL / USD"
              value={`$${stats.walUsdRate.usdPerWal.toFixed(4)}`}
              hint={`Tatum Crypto Price API · ${stats.walUsdRate.cached ? '24h cached' : 'live'}`}
            />
            <StatCard
              label="Walrus storage"
              value={`$${(stats.walUsdRate.usdPerWal * 0.023).toFixed(5)}/GB·mo`}
              hint="USD-pegged · published May 13 2026"
            />
            <StatCard
              label="Sui RPC"
              value="sui-*.gateway.tatum.io"
              hint="failover → fullnode.{net}.sui.io"
            />
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 font-headline text-xl font-semibold">Top earners</h2>
        {stats.topSellers.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No earnings yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-outline-variant/30">
            <table className="min-w-full text-sm">
              <thead className="bg-surface-container-low text-xs uppercase text-on-surface-variant">
                <tr>
                  <th className="px-4 py-2 text-left">Seller</th>
                  <th className="px-4 py-2 text-right">Earned (USDC)</th>
                  <th className="px-4 py-2 text-right">Calls</th>
                </tr>
              </thead>
              <tbody>
                {stats.topSellers.map((s, i) => (
                  <tr key={s.seller} className="border-t border-outline-variant/20">
                    <td className="px-4 py-2 font-mono text-xs">
                      {i + 1}. {s.seller.slice(0, 6)}…{s.seller.slice(-4)}
                    </td>
                    <td className="px-4 py-2 text-right">${Number(s.earned).toFixed(2)}</td>
                    <td className="px-4 py-2 text-right">{s.calls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-headline text-xl font-semibold">Recent receipts</h2>
        {stats.recentReceipts.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No receipts yet.</p>
        ) : (
          <ul className="space-y-2">
            {stats.recentReceipts.map((r, i) => {
              const url = explorerUrl(r.network, r.tx_hash);
              return (
                <li
                  key={`${r.tx_hash}-${i}`}
                  className="flex items-center justify-between gap-4 rounded-lg border border-outline-variant/30 bg-surface px-4 py-2 text-xs"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono">{r.slug}</span>
                    <span className="text-on-surface-variant">
                      {r.buyer.slice(0, 6)}…{r.buyer.slice(-4)} · {r.network} · {r.method}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-primary">
                      ${Number(r.amount_usdc).toFixed(4)}
                    </span>
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        explorer ↗
                      </a>
                    ) : (
                      <span className="text-on-surface-variant">{r.tx_hash.slice(0, 10)}…</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: number | string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        accent
          ? 'border-primary/30 bg-primary/5'
          : 'border-outline-variant/30 bg-surface'
      }`}
    >
      <div className="text-xs uppercase text-on-surface-variant">{label}</div>
      <div className="mt-1 font-headline text-2xl font-bold text-on-surface">{value}</div>
      {hint ? <div className="text-xs text-on-surface-variant">{hint}</div> : null}
    </div>
  );
}
