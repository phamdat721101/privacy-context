'use client';

import { useEffect, useState } from 'react';
import { getAgentRecentCalls, type AgentRecentCall } from '@/lib/agents';

/**
 * AgentRecentCalls — public, anonymized live feed of an agent's paid calls.
 *
 * Sourced from `/v3/agents/:id/recent-calls` (paid_calls table). Polls
 * every `intervalMs` (default 15 s) so social-proof stays fresh without
 * the cost of an SSE connection. Server already anonymizes payer.
 *
 * SOLID:
 *   • SRP — purely render + poll. No payment, no upload, no agent state.
 *   • DIP — fetcher injected via `@/lib/agents`; component is testable
 *           by passing a stub `fetcher` prop.
 *
 * Usage:
 *   <AgentRecentCalls v3AgentId={agent.v3AgentId} limit={5} />
 *
 * If `v3AgentId` is undefined (e.g. a draft brain not yet wrapped in
 * a v3 agent row), the component renders an empty-state message rather
 * than firing impossible network calls.
 */
export interface AgentRecentCallsProps {
  v3AgentId: string | undefined;
  limit?: number;
  intervalMs?: number;
  className?: string;
  /** Test seam: override the network fetcher. */
  fetcher?: (id: string, n: number) => Promise<AgentRecentCall[]>;
}

const STATUS_STYLES: Record<AgentRecentCall['status'], string> = {
  success: 'border-secondary/30 bg-secondary/10 text-secondary',
  demo: 'border-tertiary/30 bg-tertiary/10 text-tertiary',
  free: 'border-outline-variant/40 bg-surface-container-low text-on-surface-variant',
};

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function AgentRecentCalls({
  v3AgentId,
  limit = 10,
  intervalMs = 15_000,
  className,
  fetcher = getAgentRecentCalls,
}: AgentRecentCallsProps) {
  const [rows, setRows] = useState<AgentRecentCall[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!v3AgentId) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await fetcher(v3AgentId, limit);
        if (!cancelled) {
          setRows(next);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    };
    void tick();
    const id = setInterval(tick, Math.max(5_000, intervalMs));
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [v3AgentId, limit, intervalMs, fetcher]);

  return (
    <div
      className={`rounded-xl border border-outline-variant/30 bg-surface p-4 ${className ?? ''}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
          Recent transactions
        </h3>
        <span className="flex items-center gap-1 font-mono text-[10px] text-secondary">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-secondary" />
          live
        </span>
      </div>
      {!loaded ? (
        <div className="py-3 text-center font-mono text-[11px] text-on-surface-variant">
          loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="py-3 text-center font-mono text-[11px] text-on-surface-variant">
          No paid calls yet — be the first.
        </div>
      ) : (
        <ul className="divide-y divide-outline-variant/20">
          {rows.map((r) => (
            <li
              key={r.tx_hash}
              className="flex items-center justify-between gap-2 py-1.5 font-mono text-[11px]"
              title={`${r.tx_hash} · ${r.network}`}
            >
              <span className="truncate text-primary">{r.payer}</span>
              <span className="text-on-surface">${Number(r.amount_usdc).toFixed(2)}</span>
              <span
                className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase ${STATUS_STYLES[r.status]}`}
              >
                {r.status}
              </span>
              <span className="shrink-0 text-on-surface-variant">{relTime(r.settled_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
