'use client';

/**
 * /dashboard/costs — Agent cost tracker.
 *
 * Reads the same /v3/memory/buyer/activity endpoint (totals block) and
 * renders 24h / 7d / 30d spend rollups + a simple per-brain breakdown.
 * Sui-only.
 */

import { useEffect, useMemo, useState } from 'react';
import { useActiveWallet } from '@/hooks/useActiveWallet';
import { RequireSuiNetwork } from '@/components/RequireSuiNetwork';
import { AGENT_BACKEND_URL } from '@/lib/contracts';

interface Activity {
  brain_sui_object_id: string;
  amount_usdc: string;
  title: string | null;
  refunded: boolean;
  created_at: string;
}

interface Totals {
  h24?: { total_usdc: string; query_count: string };
  d7?: { total_usdc: string; query_count: string };
  d30?: { total_usdc: string; query_count: string };
}

export default function CostsDashboardPage() {
  return (
    <RequireSuiNetwork
      title="Cost tracker is Sui-only"
      description="Switch to Sui to see your agent's MemWal spending."
    >
      <CostsDashboardInner />
    </RequireSuiNetwork>
  );
}

function CostsDashboardInner() {
  const { address } = useActiveWallet();
  const [rows, setRows] = useState<Activity[]>([]);
  const [totals, setTotals] = useState<Totals>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) return;
    fetch(`${AGENT_BACKEND_URL}/v3/memory/buyer/activity?limit=200`, {
      headers: { 'x-wallet-address': address, 'x-chain': 'sui' },
    })
      .then((r) => (r.ok ? r.json() : { activity: [], totals: {} }))
      .then((j) => {
        setRows(j.activity ?? []);
        setTotals(j.totals ?? {});
      })
      .finally(() => setLoading(false));
  }, [address]);

  const perBrain = useMemo(() => {
    const map = new Map<string, { brain: string; title: string | null; total: number; count: number }>();
    for (const r of rows) {
      if (r.refunded) continue;
      const id = r.brain_sui_object_id;
      const cur = map.get(id) ?? { brain: id, title: r.title, total: 0, count: 0 };
      cur.total += Number(r.amount_usdc);
      cur.count += 1;
      map.set(id, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 20);
  }, [rows]);

  return (
    <div className="space-y-6">
      <header className="border-b border-outline-variant/30 pb-4">
        <h1 className="font-headline text-2xl font-bold">Agent costs</h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          USDC spend across all paid MemWal queries this wallet has made.
        </p>
      </header>

      {!address ? (
        <p className="rounded-lg border border-outline-variant/40 bg-surface-container-low/60 p-6 text-sm text-on-surface-variant">
          Connect a wallet to see your spend.
        </p>
      ) : loading ? (
        <p className="py-12 text-center text-on-surface-variant">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Card label="Last 24h" total={totals.h24} />
            <Card label="Last 7 days" total={totals.d7} />
            <Card label="Last 30 days" total={totals.d30} />
          </div>

          <section>
            <h2 className="mb-3 font-headline text-lg">Top brains</h2>
            {perBrain.length === 0 ? (
              <p className="rounded-lg border border-outline-variant/40 bg-surface-container-low/60 p-4 text-sm text-on-surface-variant">
                No spend yet.
              </p>
            ) : (
              <ul className="divide-y divide-outline-variant/30 rounded-lg border border-outline-variant/40 bg-surface-container-low/60 backdrop-blur">
                {perBrain.map((b) => (
                  <li key={b.brain} className="flex items-center justify-between p-4">
                    <div>
                      <p className="font-headline text-sm text-on-surface line-clamp-1">
                        {b.title ?? b.brain.slice(0, 10) + '…'}
                      </p>
                      <p className="font-mono text-[11px] text-outline">{b.brain}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-base text-primary">${b.total.toFixed(4)}</p>
                      <p className="font-mono text-[11px] text-outline">{b.count} calls</p>
                    </div>
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

function Card({ label, total }: { label: string; total?: { total_usdc: string; query_count: string } }) {
  const usdc = Number(total?.total_usdc ?? '0');
  const count = Number(total?.query_count ?? '0');
  return (
    <div className="rounded-lg border border-outline-variant/40 bg-surface-container-low/60 p-4 backdrop-blur">
      <p className="font-mono text-[10px] uppercase tracking-widest text-outline">{label}</p>
      <p className="mt-2 font-headline text-2xl text-primary">${usdc.toFixed(4)}</p>
      <p className="font-mono text-xs text-on-surface-variant">{count} paid queries</p>
    </div>
  );
}
