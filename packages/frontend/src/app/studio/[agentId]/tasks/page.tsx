'use client';

/**
 * /studio/[agentId]/tasks — V4 Tasks & Hires (PRD-V V4).
 *
 * 3 sub-tabs (Primary / Sub-Agent / All) with a pageable list. Clicking
 * a row expands it inline to show <TaskChain /> — cheaper than a drawer
 * overlay + simpler to keyboard-navigate.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useActiveWallet } from '@/hooks/useActiveWallet';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import { TaskChain } from '@/components/studio/TaskChain';

type Role = 'primary' | 'sub' | 'all';

interface SubEntry {
  agent_id: string;
  slug: string;
  cost_usdc: number;
  attestation_hash: string;
}
interface TaskRow {
  trace_id: string;
  role: 'primary' | 'sub_agent';
  duration_ms: number | null;
  total_cost_usdc: number;
  primary_revenue_usdc: number;
  sub_agent_revenue_total_usdc: number;
  platform_fee_usdc: number;
  attestation_hash: string;
  attestation_parent_hash: string | null;
  status: 'succeeded' | 'failed' | 'timeout';
  started_at: string;
  sub_agents?: SubEntry[];
}
interface TaskList {
  tasks: TaskRow[];
  total: number;
  aggregate_revenue_usdc: number;
}

const PAGE_SIZE = 20;

export default function TasksPage(): JSX.Element {
  const { agentId } = useParams<{ agentId: string }>();
  const { authenticated } = usePrivy();
  const { address } = useActiveWallet();

  const [role, setRole] = useState<Role>('all');
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [data, setData] = useState<TaskList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated || !address || !agentId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams({ role, limit: String(PAGE_SIZE), offset: String(offset) });
        const res = await fetch(`${AGENT_BACKEND_URL}/v3/studio/agents/${agentId}/tasks?${q}`, {
          headers: { 'x-wallet-address': address },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as TaskList;
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
  }, [authenticated, address, agentId, role, offset]);

  const tasks = data?.tasks ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex gap-1 rounded-full bg-surface-container-low p-1 text-xs">
        {(['primary', 'sub', 'all'] as Role[]).map((r) => (
          <button
            key={r}
            onClick={() => {
              setRole(r);
              setOffset(0);
              setExpanded(null);
            }}
            className={`flex-1 rounded-full px-4 py-1.5 font-medium capitalize transition ${
              role === r ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {r === 'sub' ? 'Sub-agent' : r}
          </button>
        ))}
      </div>

      {/* Aggregate footer */}
      <div className="flex items-center justify-between text-xs text-on-surface-variant">
        <span>{total} hire{total === 1 ? '' : 's'} total</span>
        <span>
          Revenue (primary): ${(data?.aggregate_revenue_usdc ?? 0).toFixed(2)}
        </span>
      </div>

      {loading && (
        <div className="animate-pulse space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-surface-container-low" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="rounded-lg border border-error/40 bg-error/5 px-4 py-3 text-sm text-error">{error}</div>
      )}

      {!loading && !error && tasks.length === 0 && (
        <div className="rounded-2xl border border-dashed border-outline-variant/60 p-10 text-center">
          <p className="mb-1 text-sm font-medium">No hires yet</p>
          <p className="text-xs text-on-surface-variant">Hires appear here as buyers call your agent.</p>
        </div>
      )}

      {/* Task rows */}
      <ul className="space-y-2">
        {tasks.map((t) => {
          const isOpen = expanded === t.trace_id;
          const started = new Date(t.started_at).toLocaleString();
          return (
            <li
              key={t.trace_id + t.attestation_hash}
              className="rounded-xl border border-outline-variant/40 bg-surface-container-low"
            >
              <button
                onClick={() => setExpanded(isOpen ? null : t.trace_id)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-container"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        t.role === 'primary'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-secondary/10 text-secondary'
                      }`}
                    >
                      {t.role === 'primary' ? 'Primary' : 'Sub-agent'}
                    </span>
                    <span className="font-mono text-xs text-on-surface-variant">
                      {t.trace_id.slice(0, 12)}…
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-on-surface-variant">
                    {started} · {t.duration_ms ?? 0}ms · {t.status}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs">
                  <div className="font-semibold">${t.total_cost_usdc.toFixed(3)}</div>
                  <div className="text-on-surface-variant">
                    prim ${t.primary_revenue_usdc.toFixed(3)} · sub $
                    {t.sub_agent_revenue_total_usdc.toFixed(3)}
                  </div>
                </div>
              </button>
              {isOpen && (
                <div className="border-t border-outline-variant/40 p-4">
                  <TaskChain
                    trace_id={t.trace_id}
                    primary_attestation_hash={t.attestation_hash}
                    primary_revenue_usdc={t.primary_revenue_usdc}
                    platform_fee_usdc={t.platform_fee_usdc}
                    sub_agents={t.sub_agents}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs">
          <button
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            className="rounded-full border border-outline-variant px-3 py-1 disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="text-on-surface-variant">
            Page {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total}
            className="rounded-full border border-outline-variant px-3 py-1 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
