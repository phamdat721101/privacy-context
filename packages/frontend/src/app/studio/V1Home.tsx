'use client';

/**
 * /studio V1 Seller Home — multi-agent list with aggregate KPIs.
 *
 * PRD-V V1. Renders when FEATURE_SELLER_PORTAL_V1=true; sibling of
 * legacyMega.tsx which handles the Jul 3 mega-page rollback path.
 *
 * SOLID:
 *   • SRP — one page, one job: land sellers on their agent fleet.
 *   • DIP — fetches via /v3/studio/agents (owner-scoped via wallet header).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { AppShell } from '@/components/AppShell';
import { useActiveWallet } from '@/hooks/useActiveWallet';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import { KPICard } from '@/components/studio/KPICard';

interface StudioAgent {
  id: string;
  slug: string;
  display_name: string;
  training_stage: number;
  kpis: {
    revenue_usdc_mtd: number;
    hires_mtd: number;
    reputation_score: number;
    credits_earned_usdc_mtd: number;
  };
  pending_actions: {
    dream_diffs_pending: number;
    federation_broadcasts_pending: number;
  };
}

interface StudioAgentList {
  agents: StudioAgent[];
  aggregate: {
    total_revenue_usdc_mtd: number;
    total_hires_mtd: number;
    avg_reputation_score: number;
  };
}

const STAGE_LABELS = ['Onboarded', 'SkillsAdded', 'Evaluated', 'Orchestrator', 'Dreamed'];

export default function StudioHomeV1(): JSX.Element {
  const { ready, authenticated, login } = usePrivy();
  const { address } = useActiveWallet();
  const [data, setData] = useState<StudioAgentList | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !authenticated || !address) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${AGENT_BACKEND_URL}/v3/studio/agents`, {
          headers: { 'x-wallet-address': address, accept: 'application/json' },
        });
        if (res.status === 501) {
          throw new Error('FEATURE_SELLER_PORTAL_V1 is disabled on this OpenX instance');
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as StudioAgentList;
        if (!cancelled) setData(body);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, address]);

  if (!ready) return <AppShell>{null}</AppShell>;

  if (!authenticated || !address) {
    return (
      <AppShell>
        <div className="mx-auto max-w-4xl px-4 py-16 text-center">
          <h1 className="mb-2 font-headline text-3xl font-bold">Studio — your agent cockpit</h1>
          <p className="mb-6 text-on-surface-variant">Sign in to see your fleet.</p>
          <button
            onClick={login}
            className="rounded-full bg-primary px-6 py-3 text-on-primary hover:opacity-90"
          >
            Sign in
          </button>
        </div>
      </AppShell>
    );
  }

  if (loading) {
    return (
      <AppShell>
        <div className="mx-auto max-w-6xl px-4 py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-24 rounded-2xl bg-surface-container-low" />
            <div className="grid gap-4 md:grid-cols-3">
              <div className="h-40 rounded-2xl bg-surface-container-low" />
              <div className="h-40 rounded-2xl bg-surface-container-low" />
              <div className="h-40 rounded-2xl bg-surface-container-low" />
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell>
        <div className="mx-auto max-w-3xl px-4 py-8">
          <div className="rounded-2xl border border-error/40 bg-error/5 p-6 text-error">
            <p className="mb-2 font-semibold">Couldn&apos;t load your studio.</p>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      </AppShell>
    );
  }

  const agents = data?.agents ?? [];
  const agg = data?.aggregate ?? { total_revenue_usdc_mtd: 0, total_hires_mtd: 0, avg_reputation_score: 0 };

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
        {/* Header */}
        <div className="mb-6 flex flex-col justify-between gap-3 md:mb-8 md:flex-row md:items-end">
          <div>
            <h1 className="font-headline text-3xl font-bold tracking-tight">Studio</h1>
            <p className="mt-1 text-sm text-on-surface-variant">
              {agents.length === 0
                ? 'Onboard your first agent to get started.'
                : `${agents.length} agent${agents.length === 1 ? '' : 's'} in your fleet.`}
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/studio?tab=onboard"
              className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:opacity-90"
            >
              + Onboard agent
            </Link>
            <Link
              href="/studio?tab=browse"
              className="rounded-full border border-outline-variant px-4 py-2 text-sm hover:bg-surface-container-low"
            >
              Browse kits
            </Link>
          </div>
        </div>

        {/* Aggregate KPI header */}
        {agents.length > 0 && (
          <div className="mb-8 grid gap-3 md:grid-cols-3">
            <KPICard label="Revenue MTD" value={`$${agg.total_revenue_usdc_mtd.toFixed(2)}`} />
            <KPICard label="Hires MTD" value={agg.total_hires_mtd.toString()} />
            <KPICard label="Avg reputation" value={agg.avg_reputation_score.toFixed(2)} />
          </div>
        )}

        {/* Empty state */}
        {agents.length === 0 && (
          <div className="rounded-2xl border border-dashed border-outline-variant p-10 text-center">
            <p className="mb-2 text-lg font-semibold">No agents yet</p>
            <p className="mb-6 text-sm text-on-surface-variant">
              Describe your agent in plain English — OpenX publishes a paywalled listing in 10 seconds.
            </p>
            <Link
              href="/studio?tab=onboard"
              className="inline-block rounded-full bg-primary px-6 py-3 text-on-primary hover:opacity-90"
            >
              Onboard your first agent
            </Link>
          </div>
        )}

        {/* Agent grid */}
        {agents.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {agents.map((a) => (
              <Link
                key={a.id}
                href={`/studio/${a.id}`}
                className="group flex flex-col gap-3 rounded-2xl border border-outline-variant/40 bg-surface-container-low p-5 transition hover:border-primary/60 hover:bg-surface-container"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-headline text-lg font-semibold group-hover:text-primary">
                      {a.display_name}
                    </div>
                    <div className="truncate text-xs text-on-surface-variant">/{a.slug}</div>
                  </div>
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    Stage {a.training_stage} · {STAGE_LABELS[a.training_stage] ?? 'Unknown'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-on-surface-variant">Rev MTD</div>
                    <div className="font-semibold">${a.kpis.revenue_usdc_mtd.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-on-surface-variant">Hires MTD</div>
                    <div className="font-semibold">{a.kpis.hires_mtd}</div>
                  </div>
                </div>
                {a.pending_actions.dream_diffs_pending > 0 && (
                  <div className="rounded-lg bg-tertiary/10 px-3 py-2 text-xs text-tertiary">
                    {a.pending_actions.dream_diffs_pending} pending dream diff
                    {a.pending_actions.dream_diffs_pending === 1 ? '' : 's'} → review in Memory tab
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
