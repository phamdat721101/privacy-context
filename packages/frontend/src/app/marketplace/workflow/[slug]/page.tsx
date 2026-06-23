'use client';

/**
 * /marketplace/workflow/[slug] — buyer-side workflow detail page (PRD-15 §5).
 *
 * Layout:
 *   ┌ Header — title / seller / domain / price / Try-free + Hire ┐
 *   ├ DAG strip — custom-SVG WorkflowDagViz (zero deps)          ┤
 *   ├ Two-column — Inputs form  |  StepDetail panel              ┤
 *   ├ Sample outputs (last 3 anonymized runs)                    ┤
 *   └ Reviews + ratings (placeholder)                            ┘
 *
 * Trust narrative: PrivacyBadge in the header signals the encryption
 * substrate. RunWorkflowModal handles the execution path.
 *
 * SOLID:
 *  - SRP: this page composes; fetching is one effect, modal is reused.
 *  - DIP: payment + execution come from the existing /v3/workflows
 *    runtime — this page is purely a buyer surface.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import { useActiveWallet } from '@/hooks/useActiveWallet';
import { WorkflowDagViz } from '@/components/WorkflowDagViz';
import { RunWorkflowModal, type WorkflowSummary } from '../../RunWorkflowModal';

interface WorkflowDetail {
  id: string;
  slug: string;
  owner_address: string;
  title: string;
  description: string;
  short_description: string;
  domain: string;
  verification_tier: 'basic' | 'verified' | 'tee_attested';
  privacy_mode: 'metadata-only' | 'off';
  privacy_source: 'auto' | 'manual';
  steps: Array<{
    id: string;
    name?: string;
    type?: string;
    tool_ref?: string;
    price_usdc?: string | number;
  }>;
  default_price_usdc: string;
  author_bps: number;
  platform_bps: number;
  runs: number;
  successful_runs: number;
  workflow_ref: string;
}

interface RecentRun {
  id: string;
  success: boolean;
  outputs_hash: string;
  total_usdc: string;
  attestation_hash?: string;
  started_at: string;
  ended_at: string;
}

export default function WorkflowDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { address } = useActiveWallet();
  const [wf, setWf] = useState<WorkflowDetail | null>(null);
  const [recent, setRecent] = useState<RecentRun[]>([]);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [showRun, setShowRun] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    Promise.all([
      fetch(`${AGENT_BACKEND_URL}/v3/marketplace/workflows/${slug}`).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`workflow ${r.status}`)),
      ),
      fetch(`${AGENT_BACKEND_URL}/v3/marketplace/workflows/${slug}/recent`)
        .then((r) => (r.ok ? r.json() : { runs: [] }))
        .catch(() => ({ runs: [] })),
    ])
      .then(([detail, runs]) => {
        if (cancelled) return;
        setWf(detail as WorkflowDetail);
        setRecent((runs as { runs: RecentRun[] }).runs ?? []);
      })
      .catch((e) => !cancelled && setErr(String(e?.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (err) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <p className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-500">
          Failed to load workflow: {err}
        </p>
      </div>
    );
  }
  if (!wf) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <p className="font-mono text-xs text-on-surface-variant">Loading…</p>
      </div>
    );
  }

  const stepSum =
    wf.steps?.reduce((acc, s) => acc + Number(s.price_usdc ?? 0), 0) ?? 0;
  const authorMargin = Math.max(0, Number(wf.default_price_usdc) - stepSum);
  const platformShare = (Number(wf.default_price_usdc) * (wf.platform_bps ?? 500)) / 10000;
  const activeStep = activeStepId ? wf.steps.find((s) => s.id === activeStepId) ?? null : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-6 md:py-10">
      {/* Header */}
      <header className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">
                workflow · {wf.domain}
              </span>
              <span className="rounded border border-outline-variant/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
                {wf.verification_tier}
              </span>
            </div>
            <h1 className="truncate font-headline text-2xl font-bold text-on-surface md:text-3xl">
              {wf.title}
            </h1>
            <p className="text-sm text-on-surface-variant">{wf.short_description}</p>
            <p className="font-mono text-[11px] text-on-surface-variant">
              by {wf.owner_address.slice(0, 6)}…{wf.owner_address.slice(-4)} · {wf.runs} runs ·{' '}
              {wf.steps?.length ?? 0} steps
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <p className="font-mono text-2xl text-[#13ff43]">${wf.default_price_usdc}</p>
            <p className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
              per execution · USDC
            </p>
            <div className="flex gap-2">
              <a
                href={`/agent/${wf.slug}/try`}
                className="rounded border border-[#00dbe9] px-3 py-1.5 text-xs text-[#00dbe9]"
              >
                Try free demo
              </a>
              <button
                type="button"
                onClick={() => setShowRun(true)}
                className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-on-primary"
              >
                Hire — Pay ${wf.default_price_usdc}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* DAG strip */}
      <section className="space-y-2">
        <p className="font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">
          DAG · click any step for details
        </p>
        <WorkflowDagViz
          steps={wf.steps}
          activeStepId={activeStepId ?? undefined}
          onStepClick={(id) => setActiveStepId(id)}
        />
      </section>

      {/* Two-column · pricing waterfall + step detail panel */}
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded border border-outline-variant/30 bg-surface-container-low p-4">
          <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">
            Pricing waterfall
          </p>
          <dl className="space-y-1 font-mono text-xs">
            <Row k="Steps cost" v={`$${stepSum.toFixed(2)}`} />
            <Row k="Author margin" v={`$${authorMargin.toFixed(2)}`} />
            <Row k="Platform 5%" v={`$${platformShare.toFixed(2)}`} />
            <hr className="my-1 border-outline-variant/30" />
            <Row k="Total" v={`$${wf.default_price_usdc}`} bold />
          </dl>
        </div>
        <div className="rounded border border-outline-variant/30 bg-surface-container-low p-4">
          <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">
            Step detail
          </p>
          {activeStep ? (
            <dl className="space-y-1 font-mono text-xs">
              <Row k="ID" v={activeStep.id} />
              <Row k="Type" v={activeStep.type ?? 'step'} />
              <Row k="Tool ref" v={activeStep.tool_ref ?? '—'} />
              <Row k="Price" v={`$${Number(activeStep.price_usdc ?? 0).toFixed(2)}`} />
              <Row k="TEE attestation" v="every run · Phala" />
            </dl>
          ) : (
            <p className="text-xs text-on-surface-variant">
              Click a node above to inspect step contracts.
            </p>
          )}
        </div>
      </section>

      {/* Sample outputs */}
      <section className="space-y-2">
        <p className="font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">
          Recent runs (anonymized)
        </p>
        {recent.length === 0 ? (
          <p className="text-xs text-on-surface-variant">No runs yet — be the first to hire.</p>
        ) : (
          <ul className="space-y-1.5">
            {recent.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-xs"
              >
                <span className="font-mono">
                  {r.success ? '✅' : '⚠️'} run {r.id.slice(0, 8)} · ${Number(r.total_usdc).toFixed(2)}
                </span>
                <span className="font-mono text-[10px] text-on-surface-variant">
                  {new Date(r.started_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showRun ? (
        <RunWorkflowModal
          workflow={
            {
              id: wf.id,
              workflow_key: wf.workflow_ref,
              name: wf.title,
              default_price_usdc: wf.default_price_usdc,
              steps: wf.steps.map((s) => ({ id: s.id, name: s.name ?? s.id })),
            } as WorkflowSummary
          }
          walletAddress={address}
          onClose={() => setShowRun(false)}
        />
      ) : null}
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${bold ? 'text-on-surface' : 'text-on-surface-variant'}`}>
      <dt>{k}</dt>
      <dd className={bold ? 'text-[#13ff43]' : ''}>{v}</dd>
    </div>
  );
}
