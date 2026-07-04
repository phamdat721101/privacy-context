'use client';

/**
 * /studio/[agentId] — V2 Overview (PRD-V V2).
 *
 * Composes: agent header + TrainingStagePill + 4 KPICards + SetupChecklist
 * + AgentRecentCalls (Jun 15 reuse) + quick actions sidebar. SWR-ish
 * poll every 30s for live counts (dream diffs, KPIs). No background
 * mutation — pure display.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useActiveWallet } from '@/hooks/useActiveWallet';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import { AgentRecentCalls } from '@/components/AgentRecentCalls';
import { KPICard } from '@/components/studio/KPICard';
import { TrainingStagePill } from '@/components/studio/TrainingStagePill';
import { SetupChecklist, type SetupChecklistStep } from '@/components/studio/SetupChecklist';

interface AgentOverview {
  agent: {
    id: string;
    slug: string;
    display_name: string;
    persona: { system_prompt?: string | null } | null;
    endpoint_url: string | null;
    last_hire_at: string | null;
  };
  training_stage: number;
  stage_progress: {
    stage: number;
    stage_name: string;
    progress_to_next: { target_stage: number; target_name: string; requirement: string };
  };
  kpis: {
    revenue_usdc_mtd: number;
    hires_mtd: number;
    reputation_score: number;
    credits_earned_usdc_mtd: number;
  };
  setup_checklist: { score: number; ready: boolean; steps: SetupChecklistStep[] };
  pending_actions: { dream_diffs_pending: number; federation_broadcasts_pending: number };
}

const POLL_MS = 30_000;

export default function AgentOverviewPage(): JSX.Element {
  const { agentId } = useParams<{ agentId: string }>();
  const { ready, authenticated, login } = usePrivy();
  const { address } = useActiveWallet();
  const [data, setData] = useState<AgentOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !authenticated || !address || !agentId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchOnce = async () => {
      try {
        const res = await fetch(`${AGENT_BACKEND_URL}/v3/studio/agents/${agentId}`, {
          headers: { 'x-wallet-address': address, accept: 'application/json' },
        });
        if (res.status === 501) throw new Error('FEATURE_SELLER_PORTAL_V1 disabled on this instance');
        if (res.status === 403) throw new Error('You are not the owner of this agent');
        if (res.status === 404) throw new Error('Agent not found');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as AgentOverview;
        if (!cancelled) {
          setData(body);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchOnce();
    const iv = setInterval(fetchOnce, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      clearInterval(iv);
    };
  }, [ready, authenticated, address, agentId]);

  if (!ready) return <div />;
  if (!authenticated) {
    return (
      <div className="text-center">
        <p className="mb-3 text-on-surface-variant">Sign in to view this agent.</p>
        <button onClick={login} className="rounded-full bg-primary px-6 py-2 text-on-primary">Sign in</button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-24 rounded-2xl bg-surface-container-low" />
        <div className="grid gap-3 md:grid-cols-4">
          <div className="h-24 rounded-2xl bg-surface-container-low" />
          <div className="h-24 rounded-2xl bg-surface-container-low" />
          <div className="h-24 rounded-2xl bg-surface-container-low" />
          <div className="h-24 rounded-2xl bg-surface-container-low" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-error/40 bg-error/5 p-6 text-error">
        <p className="mb-1 font-semibold">Couldn&apos;t load agent.</p>
        <p className="text-sm">{error ?? 'Unknown error.'}</p>
      </div>
    );
  }

  const { agent, training_stage, stage_progress, kpis, setup_checklist, pending_actions } = data;
  const lastHireLabel = agent.last_hire_at ? new Date(agent.last_hire_at).toLocaleString() : 'no hires yet';

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Main column */}
      <div className="space-y-6 lg:col-span-2">
        {/* Agent header */}
        <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <h1 className="font-headline text-2xl font-bold">{agent.display_name}</h1>
              <div className="mt-1 text-sm text-on-surface-variant">
                /{agent.slug} · last hire: {lastHireLabel}
              </div>
            </div>
            <TrainingStagePill stage={training_stage} progress={stage_progress} />
          </div>
          {agent.endpoint_url && (
            <div className="mt-3 truncate text-xs text-on-surface-variant">
              Endpoint: <span className="font-mono">{agent.endpoint_url}</span>
            </div>
          )}
        </div>

        {/* KPI cards */}
        <div className="grid gap-3 md:grid-cols-4">
          <KPICard label="Revenue MTD" value={`$${kpis.revenue_usdc_mtd.toFixed(2)}`} />
          <KPICard label="Hires MTD" value={kpis.hires_mtd.toString()} />
          <KPICard label="Reputation" value={kpis.reputation_score.toFixed(2)} hint="v1.1 populates from 402radar" />
          <KPICard label="Credits earned" value={`$${kpis.credits_earned_usdc_mtd.toFixed(2)}`} />
        </div>

        {/* Setup checklist */}
        <SetupChecklist
          score={setup_checklist.score}
          ready={setup_checklist.ready}
          steps={setup_checklist.steps}
        />

        {/* Recent activity */}
        <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-5">
          <h3 className="mb-3 font-headline text-sm font-semibold">Recent activity</h3>
          <AgentRecentCalls v3AgentId={agent.id} limit={10} />
        </div>
      </div>

      {/* Sidebar */}
      <aside className="space-y-4">
        <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-5">
          <h3 className="mb-3 font-headline text-sm font-semibold">Quick actions</h3>
          <div className="space-y-2 text-sm">
            <Link
              href={`/studio/${agentId}/training`}
              className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-surface-container"
            >
              <span>Upload SKILL.md</span>
              <span aria-hidden>→</span>
            </Link>
            <Link
              href={`/studio/${agentId}/memory`}
              className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-surface-container"
            >
              <span className="flex items-center gap-2">
                Review dream diffs
                {pending_actions.dream_diffs_pending > 0 && (
                  <span className="rounded-full bg-tertiary px-2 py-0.5 text-xs text-on-tertiary">
                    {pending_actions.dream_diffs_pending}
                  </span>
                )}
              </span>
              <span aria-hidden>→</span>
            </Link>
            <Link
              href={`/studio/${agentId}/tasks`}
              className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-surface-container"
            >
              <span>View hires + attestation chain</span>
              <span aria-hidden>→</span>
            </Link>
            <Link
              href={`/agent/${agent.slug}`}
              className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-surface-container"
            >
              <span>Buyer-side listing</span>
              <span aria-hidden>↗</span>
            </Link>
          </div>
        </div>
      </aside>
    </div>
  );
}
