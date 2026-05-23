'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { EarningsReceipt, PriceChip } from '@fhe-ai-context/ui';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import { createLogger } from '@/lib/clientLogger';

const log = createLogger('earningsPage');

interface BrainEarning {
  id: number;
  title: string;
  tags: string[];
  queryCount: number;
  earnedUsdc: number;
  lastAt: string | null;
}

interface Receipt {
  brainId: number;
  brainTitle: string;
  agentAddress: string;
  amount: string;
  currency: string;
  at: string;
}

interface EarningsPayload {
  wallet: string;
  pricePerQueryUsdc: number;
  totalQueries: number;
  totalUsdc: number;
  brains: BrainEarning[];
  receipts: Receipt[];
}

interface RailTotal { rail: 'x402' | 'mpp' | 'sui_usdc'; calls: string; total_usdc: string }
interface V3Earnings { totals_by_rail: RailTotal[]; recent_receipts: Array<{ rail: string; amount_usdc: string; tx_or_receipt: string; created_at: string; agent_id: string }> }

const POLL_MS = 5_000;
const RAIL_LABEL: Record<string, string> = { x402: 'x402', mpp: 'MPP (Tempo)', sui_usdc: 'Sui USDC' };

export default function EarningsPage() {
  const { authenticated, user, login } = usePrivy();
  const wallet = user?.wallet?.address;
  const [data, setData] = useState<EarningsPayload | null>(null);
  const [v3, setV3] = useState<V3Earnings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const r = await fetch(`${AGENT_BACKEND_URL}/brains/earnings/${wallet}`, {
          headers: { 'x-wallet-address': wallet },
        });
        if (!r.ok) throw new Error(`${r.status}`);
        const json = (await r.json()) as EarningsPayload;
        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      }
      // v3 — soft fail if older API.
      try {
        const r2 = await fetch(`${AGENT_BACKEND_URL}/v3/earnings/${wallet}`, {
          headers: { 'x-wallet-address': wallet },
        });
        if (r2.ok) {
          const j = (await r2.json()) as V3Earnings;
          if (!cancelled) setV3(j);
        }
      } catch (e: any) {
        log.warn('v3:earnings:unavailable', { err: e?.message });
      }
    };
    fetchOnce();
    const id = setInterval(fetchOnce, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [wallet]);

  if (!authenticated) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="font-headline text-2xl font-bold">Sign in to see your earnings</h1>
        <button
          type="button"
          onClick={login}
          className="mt-4 rounded-full bg-primary px-5 py-2 text-on-primary hover:opacity-90"
        >
          Sign in
        </button>
      </div>
    );
  }

  if (error && !data) {
    return <div className="py-12 text-center text-error">Failed to load earnings: {error}</div>;
  }

  if (!data) {
    return <div className="py-12 text-center text-on-surface-variant">Loading earnings…</div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-8">
      <header className="space-y-2">
        <h1 className="font-headline text-3xl font-bold">Your earnings</h1>
        <div className="flex items-center gap-3 text-on-surface-variant">
          <PriceChip amount={data.pricePerQueryUsdc.toFixed(2)} />
          <span>·</span>
          <span>
            <span className="font-mono text-secondary">${data.totalUsdc.toFixed(2)} USDC</span>{' '}
            from {data.totalQueries} {data.totalQueries === 1 ? 'query' : 'queries'}
          </span>
        </div>
      </header>

      {/* v3 per-rail breakdown — additive; soft-fails if API is older */}
      {v3 && (
        <section className="rounded-xl border border-outline-variant/30 bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-headline text-lg font-semibold">Per-rail (v3)</h2>
            <span className="text-xs text-on-surface-variant">x402 · MPP · Sui USDC</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(['x402', 'mpp', 'sui_usdc'] as const).map((rail) => {
              const t = v3.totals_by_rail.find((x) => x.rail === rail);
              return (
                <div key={rail} className="rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2">
                  <div className="text-[10px] uppercase text-on-surface-variant">{RAIL_LABEL[rail]}</div>
                  <div className="mt-1 text-lg font-semibold text-secondary">${Number(t?.total_usdc ?? 0).toFixed(2)}</div>
                  <div className="text-[10px] text-on-surface-variant">{t?.calls ?? 0} calls</div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {data.brains.length === 0 ? (
        <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-10 text-center">
          <p className="text-on-surface-variant">You haven't published a brain yet.</p>
          <Link
            href="/publish"
            className="mt-3 inline-block rounded-full bg-primary px-4 py-2 text-on-primary hover:opacity-90"
          >
            Publish your first note →
          </Link>
        </div>
      ) : (
        <section className="space-y-3">
          <h2 className="font-headline text-lg font-semibold">Per-brain</h2>
          <div className="space-y-2">
            {data.brains.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant/30 bg-surface px-4 py-3"
              >
                <div>
                  <div className="font-medium text-on-surface">{b.title}</div>
                  <div className="text-xs text-text-muted">
                    {b.queryCount} {b.queryCount === 1 ? 'query' : 'queries'}
                    {b.tags.length ? ` · ${b.tags.join(', ')}` : ''}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-secondary">+${b.earnedUsdc.toFixed(2)}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.receipts.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-headline text-lg font-semibold">Recent receipts</h2>
          <div className="space-y-2">
            {data.receipts.map((r, i) => (
              <EarningsReceipt
                key={`${r.brainId}-${r.at}-${i}`}
                amount={r.amount}
                currency={r.currency}
                agentAddress={r.agentAddress}
                at={r.at}
              />
            ))}
          </div>
        </section>
      )}

      <p className="text-center text-xs text-text-muted">
        Live. Updated every {POLL_MS / 1000}s.
      </p>
    </div>
  );
}
