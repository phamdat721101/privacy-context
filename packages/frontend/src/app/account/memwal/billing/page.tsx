'use client';

/**
 * /account/memwal/billing — full seller earnings breakdown.
 *
 * Reads /v3/memory/operator/stats which already aggregates settlements +
 * brain rollups. Renders per-brain earnings sorted by revenue.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useActiveWallet } from '@/hooks/useActiveWallet';
import { RequireSuiNetwork } from '@/components/RequireSuiNetwork';
import { AGENT_BACKEND_URL } from '@/lib/contracts';

interface Brain {
  sui_object_id: string;
  title: string;
  namespace: string;
  cognitive_level: number;
  active: boolean;
  price_per_query_usdc: string;
}

interface Earnings {
  total_revenue: string;
  query_count: string;
  last_24h: string;
  operator_amount: string;
}

export default function BillingPage() {
  return (
    <RequireSuiNetwork
      title="Billing is Sui-only"
      description="Switch to Sui to view your seller earnings."
    >
      <BillingInner />
    </RequireSuiNetwork>
  );
}

function BillingInner() {
  const { address } = useActiveWallet();
  const [brains, setBrains] = useState<Brain[]>([]);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) {
      setLoading(false);
      return;
    }
    fetch(`${AGENT_BACKEND_URL}/v3/memory/operator/stats`, {
      headers: { 'x-wallet-address': address, 'x-chain': 'sui' },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j) {
          setBrains(j.brains ?? []);
          setEarnings(j.earnings ?? null);
        }
      })
      .finally(() => setLoading(false));
  }, [address]);

  const total = useMemo(() => Number(earnings?.total_revenue ?? '0'), [earnings]);
  const operatorCut = useMemo(() => Number(earnings?.operator_amount ?? '0'), [earnings]);
  const sellerNet = total;
  const grossRevenue = total + operatorCut;

  return (
    <div className="space-y-6">
      <header className="border-b border-outline-variant/30 pb-4">
        <Link href="/account/memwal" className="text-xs text-on-surface-variant hover:text-primary">
          ← MemWal account
        </Link>
        <h1 className="mt-1 font-headline text-2xl font-bold">Billing</h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          Cumulative seller earnings settled on-chain by the OpenX revenue-split worker.
        </p>
      </header>

      {!address ? (
        <p className="rounded-lg border border-outline-variant/40 bg-surface-container-low/60 p-6 text-sm text-on-surface-variant">
          Connect a wallet to view billing.
        </p>
      ) : loading ? (
        <p className="py-12 text-center text-on-surface-variant">Loading…</p>
      ) : (
        <>
          {/* Top-line numbers */}
          <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Card label="Net to seller" value={`$${sellerNet.toFixed(4)}`} primary />
            <Card label="OpenX cut" value={`$${operatorCut.toFixed(4)}`} />
            <Card
              label="Gross revenue"
              value={`$${grossRevenue.toFixed(4)}`}
              detail={`${earnings?.query_count ?? '0'} paid queries`}
            />
            <Card label="24h queries" value={earnings?.last_24h ?? '0'} />
          </section>

          {/* Per-brain rollup */}
          <section>
            <h2 className="mb-3 font-headline text-lg">Per-brain</h2>
            {brains.length === 0 ? (
              <p className="rounded-lg border border-outline-variant/40 bg-surface-container-low/60 p-4 text-sm text-on-surface-variant">
                No published brains.
              </p>
            ) : (
              <ul className="divide-y divide-outline-variant/30 rounded-lg border border-outline-variant/40 bg-surface-container-low/60 backdrop-blur">
                {brains.map((b) => (
                  <li key={b.sui_object_id} className="flex items-center justify-between p-4">
                    <div>
                      <p className="font-headline text-sm text-on-surface line-clamp-1">{b.title}</p>
                      <p className="font-mono text-[11px] text-outline">
                        {b.namespace} · L{b.cognitive_level} · ${Number(b.price_per_query_usdc).toFixed(4)}/query
                      </p>
                    </div>
                    <Link
                      href={`/marketplace/${b.sui_object_id}`}
                      className="font-mono text-[11px] text-primary hover:underline"
                    >
                      view →
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

function Card({
  label,
  value,
  detail,
  primary,
}: {
  label: string;
  value: string;
  detail?: string;
  primary?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 backdrop-blur ${
        primary
          ? 'border-primary/40 bg-primary/5'
          : 'border-outline-variant/40 bg-surface-container-low/60'
      }`}
    >
      <p className="font-mono text-[10px] uppercase tracking-widest text-outline">{label}</p>
      <p
        className={`mt-1 font-headline text-2xl ${
          primary ? 'text-primary' : 'text-on-surface'
        }`}
      >
        {value}
      </p>
      {detail && <p className="font-mono text-[11px] text-on-surface-variant">{detail}</p>}
    </div>
  );
}
