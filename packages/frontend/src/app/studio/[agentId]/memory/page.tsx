'use client';

/**
 * /studio/[agentId]/memory — V5 Dream Memory Console (PRD-V V5).
 *
 * Renders:
 *   • Pending dream runs at top (grouped diffs per run) with per-run
 *     "Sign & Apply" button. One EIP-712 signature covers the selected
 *     diff_ids in that run.
 *   • Auto-dream run history timeline (all runs).
 *
 * Persona rollback + CognitiveLanes memory viewer are v1.1 backlog per
 * essential-only rule.
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useSignTypedData } from 'wagmi';
import { useActiveWallet } from '@/hooks/useActiveWallet';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import { DreamDiffReview, type DreamDiffCard } from '@/components/studio/DreamDiffReview';

interface DreamRun {
  run_id: string;
  status: string;
  cost_usdc: number;
  phases_completed: string[];
  diff_count: number;
  hires_analyzed: number;
  started_at: string;
  finished_at: string | null;
  diffs?: DreamDiffCard[];
}

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 421614);

const EIP712_DOMAIN = {
  name: 'OpenX Auto-Dream',
  version: '1',
  chainId: CHAIN_ID,
} as const;

const EIP712_TYPES = {
  DreamApproval: [
    { name: 'run_id', type: 'string' },
    { name: 'agent_id', type: 'string' },
    { name: 'action', type: 'string' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'selected_diff_ids', type: 'string[]' },
  ],
} as const;

export default function MemoryPage(): JSX.Element {
  const { agentId } = useParams<{ agentId: string }>();
  const { authenticated } = usePrivy();
  const { address } = useActiveWallet();
  const { signTypedDataAsync } = useSignTypedData();

  const [runs, setRuns] = useState<DreamRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedByRun, setSelectedByRun] = useState<Record<string, Set<string>>>({});
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!authenticated || !address || !agentId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${AGENT_BACKEND_URL}/v3/studio/agents/${agentId}/dream/runs`, {
          headers: { 'x-wallet-address': address },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { runs: DreamRun[] };
        if (!cancelled) setRuns(body.runs);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticated, address, agentId, reloadTick]);

  const pendingRuns = useMemo(
    () => runs.filter((r) => r.status === 'pending_approval'),
    [runs],
  );
  const otherRuns = useMemo(
    () => runs.filter((r) => r.status !== 'pending_approval'),
    [runs],
  );

  function toggleDiff(runId: string, diffId: string, checked: boolean): void {
    setSelectedByRun((prev) => {
      const next = { ...prev };
      const set = new Set(next[runId] ?? []);
      if (checked) set.add(diffId);
      else set.delete(diffId);
      next[runId] = set;
      return next;
    });
  }

  async function signAndApply(run: DreamRun, action: 'approve' | 'reject'): Promise<void> {
    if (!agentId || !address) return;
    const selected = Array.from(selectedByRun[run.run_id] ?? []);
    if (action === 'approve' && selected.length === 0) {
      setError('Select at least one diff to apply.');
      return;
    }
    setBusyRunId(run.run_id);
    setError(null);
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const message = {
        run_id: run.run_id,
        agent_id: agentId,
        action,
        timestamp: BigInt(timestamp),
        selected_diff_ids: action === 'reject' ? [] : selected,
      };

      const signature = await signTypedDataAsync({
        domain: EIP712_DOMAIN,
        types: EIP712_TYPES,
        primaryType: 'DreamApproval',
        message,
      });

      const res = await fetch(
        `${AGENT_BACKEND_URL}/v3/agents/${agentId}/dream/${run.run_id}/approve`,
        {
          method: 'POST',
          headers: {
            'x-wallet-address': address,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            action,
            timestamp,
            selected_diff_ids: action === 'reject' ? [] : selected,
            signature,
          }),
        },
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.message ?? `HTTP ${res.status}`);
      }
      setSelectedByRun((prev) => ({ ...prev, [run.run_id]: new Set() }));
      setReloadTick((t) => t + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyRunId(null);
    }
  }

  if (!authenticated) return <div>Sign in required.</div>;

  return (
    <div className="space-y-6">
      {/* Pending runs */}
      <section>
        <h2 className="mb-3 font-headline text-lg font-semibold">Pending dream diffs</h2>
        {loading && <div className="h-32 animate-pulse rounded-2xl bg-surface-container-low" />}
        {!loading && pendingRuns.length === 0 && (
          <div className="rounded-2xl border border-dashed border-outline-variant/60 p-8 text-center text-sm text-on-surface-variant">
            No pending diffs. Auto-dream runs weekly Sun 03:00 UTC when your agent has ≥ 10 hires
            since the last cycle.
          </div>
        )}
        {pendingRuns.map((run) => {
          const selected = selectedByRun[run.run_id] ?? new Set<string>();
          const busy = busyRunId === run.run_id;
          return (
            <div
              key={run.run_id}
              className="mb-4 rounded-2xl border border-outline-variant/40 bg-surface-container-low p-5"
            >
              <div className="mb-3 flex flex-col justify-between gap-2 md:flex-row md:items-center">
                <div>
                  <div className="font-mono text-xs text-on-surface-variant">
                    Run {run.run_id.slice(0, 8)}… · started {new Date(run.started_at).toLocaleString()}
                  </div>
                  <div className="mt-1 text-xs">
                    {run.diff_count} diff{run.diff_count === 1 ? '' : 's'} · $
                    {run.cost_usdc.toFixed(2)} spent · {run.hires_analyzed} hires analyzed
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => signAndApply(run, 'reject')}
                    disabled={busy}
                    className="rounded-full border border-outline-variant px-4 py-1.5 text-xs hover:bg-surface-container disabled:opacity-40"
                  >
                    Reject all
                  </button>
                  <button
                    onClick={() => signAndApply(run, 'approve')}
                    disabled={busy || selected.size === 0}
                    className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-on-primary hover:opacity-90 disabled:opacity-40"
                  >
                    {busy ? 'Signing…' : `Sign & apply (${selected.size})`}
                  </button>
                </div>
              </div>
              <div className="space-y-3">
                {(run.diffs ?? []).map((d) => (
                  <DreamDiffReview
                    key={d.diff_id}
                    diff={d}
                    selected={selected.has(d.diff_id)}
                    disabled={busy}
                    onSelectedChange={(next) => toggleDiff(run.run_id, d.diff_id, next)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {error && (
        <div className="rounded-lg border border-error/40 bg-error/5 px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}

      {/* Run history timeline */}
      <section>
        <h2 className="mb-3 font-headline text-lg font-semibold">Run history</h2>
        {otherRuns.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No completed runs yet.</p>
        ) : (
          <ol className="relative space-y-3 border-l-2 border-outline-variant/40 pl-4">
            {otherRuns.map((r) => (
              <li key={r.run_id} className="relative">
                <span
                  className={`absolute -left-[9px] top-2 h-3 w-3 rounded-full border-2 ${
                    r.status === 'approved'
                      ? 'border-secondary bg-secondary'
                      : r.status === 'rejected'
                      ? 'border-outline-variant bg-surface-container-low'
                      : 'border-error bg-error'
                  }`}
                />
                <div className="rounded-lg border border-outline-variant/40 bg-surface-container-low px-4 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs">
                      {new Date(r.started_at).toLocaleString()}
                    </span>
                    <span className="rounded-full bg-surface-container px-2 py-0.5 text-[10px] uppercase tracking-wide text-on-surface-variant">
                      {r.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-on-surface-variant">
                    {r.diff_count} diff{r.diff_count === 1 ? '' : 's'} · $
                    {r.cost_usdc.toFixed(2)} · phases {r.phases_completed.join(' → ')}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
