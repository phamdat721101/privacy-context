'use client';

/**
 * TaskChain — attestation chain viewer (PRD-V V4).
 *
 * Renders a primary row + its sub-agent rows as an indented tree, each
 * node showing the truncated attestation_hash and revenue split. Parent
 * relationships come from sub_agent_hires.parent_hash — the primary's
 * attestation_hash IS the sub's parent_hash.
 */

interface SubHire {
  agent_id: string;
  slug: string;
  cost_usdc: number;
  attestation_hash: string;
}

interface TaskChainProps {
  trace_id: string;
  primary_attestation_hash: string;
  primary_slug?: string;
  primary_revenue_usdc: number;
  platform_fee_usdc: number;
  sub_agents?: SubHire[];
  className?: string;
}

function shortHash(h: string): string {
  const clean = h.startsWith('sha256:') ? h.slice(7) : h;
  return `${clean.slice(0, 8)}…${clean.slice(-6)}`;
}

export function TaskChain({
  trace_id,
  primary_attestation_hash,
  primary_slug,
  primary_revenue_usdc,
  platform_fee_usdc,
  sub_agents,
  className,
}: TaskChainProps): JSX.Element {
  const subs = sub_agents ?? [];
  return (
    <div className={`rounded-xl border border-outline-variant/40 bg-surface-container/40 p-4 ${className ?? ''}`}>
      <div className="mb-3 text-[11px] uppercase tracking-wide text-on-surface-variant">
        Trace {trace_id.slice(0, 8)}… · Attestation chain
      </div>

      {/* Primary node */}
      <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 truncate">
            <span className="inline-block rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-on-primary">
              Primary
            </span>
            {primary_slug && <span className="ml-2 font-mono text-xs">{primary_slug}</span>}
          </div>
          <span className="shrink-0 text-xs font-medium text-secondary">
            +${primary_revenue_usdc.toFixed(3)}
          </span>
        </div>
        <div className="mt-1 truncate font-mono text-[11px] text-on-surface-variant">
          {shortHash(primary_attestation_hash)}
        </div>
      </div>

      {/* Sub-agent nodes */}
      {subs.length > 0 && (
        <div className="ml-6 mt-2 space-y-2 border-l-2 border-outline-variant/40 pl-4">
          {subs.map((s, i) => (
            <div
              key={s.agent_id + i}
              className="rounded-lg border border-secondary/40 bg-secondary/5 px-3 py-2 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 truncate">
                  <span className="inline-block rounded-full bg-secondary/20 px-2 py-0.5 text-[10px] font-medium text-secondary">
                    Sub #{i + 1}
                  </span>
                  <span className="ml-2 font-mono text-xs">{s.slug}</span>
                </div>
                <span className="shrink-0 text-xs font-medium text-secondary">
                  +${s.cost_usdc.toFixed(3)}
                </span>
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-on-surface-variant">
                parent {shortHash(primary_attestation_hash)} → {shortHash(s.attestation_hash)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex justify-between text-[11px] text-on-surface-variant">
        <span>Platform fee: ${platform_fee_usdc.toFixed(3)}</span>
        <span>{subs.length} sub-agent{subs.length === 1 ? '' : 's'}</span>
      </div>
    </div>
  );
}
