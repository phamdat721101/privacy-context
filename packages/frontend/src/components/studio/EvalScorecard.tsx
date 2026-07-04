'use client';

/**
 * EvalScorecard — PRD-V V3 empty-state MVP per C11.
 *
 * v1.0 surfaces `audit_last_run` for the caller's active skills (which
 * migration 039 already populates) + shows the 6-canonical-task grid as
 * a preview with 'coming soon' cells. The full runner ships in v1.1
 * alongside PRD-U U5+U6.
 *
 * SOLID:
 *   • SRP — display + optional "Run eval now" CTA. No client eval logic.
 */

interface SkillAuditRow {
  slug: string;
  audit_score: number;
  audit_last_run: string | null;
}

interface EvalScorecardProps {
  skills: SkillAuditRow[];
  className?: string;
}

const CANONICAL_TASKS = [
  { key: 'pay_via_x402', label: 'Pay via x402' },
  { key: 'mint_mpt', label: 'Mint XRPL MPT' },
  { key: 'transfer_usdc', label: 'Transfer USDC' },
  { key: 'query_xrpl', label: 'Query XRPL' },
  { key: 'fetch_rlusd_balance', label: 'Fetch RLUSD balance' },
  { key: 'call_paid_tool', label: 'Call paidTool()' },
];

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

export function EvalScorecard({ skills, className }: EvalScorecardProps): JSX.Element {
  const audited = skills.filter((s) => !!s.audit_last_run);
  return (
    <div
      className={`rounded-2xl border border-outline-variant/40 bg-surface-container-low p-5 ${className ?? ''}`}
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-headline text-sm font-semibold">Eval scorecard</h3>
          <p className="mt-1 text-xs text-on-surface-variant">
            v1.0 shows the last SKILL.md audit per skill. The 6-canonical-task runner ships v1.1.
          </p>
        </div>
      </div>

      {/* SKILL.md audit summary (real data, populated today by parseSkillMd) */}
      <div className="mb-4">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-on-surface-variant">
          SKILL.md audit
        </div>
        {audited.length === 0 ? (
          <div className="rounded-lg border border-dashed border-outline-variant/60 p-4 text-center text-sm text-on-surface-variant">
            No skills audited yet. Upload a SKILL.md to run the 4-pillar (Matt Pocock) audit automatically.
          </div>
        ) : (
          <ul className="space-y-1">
            {audited.map((s) => (
              <li
                key={s.slug}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-surface-container"
              >
                <span className="truncate font-mono text-xs">{s.slug}</span>
                <span className="flex items-center gap-3">
                  <span className={s.audit_score >= 0.8 ? 'text-secondary' : 'text-tertiary'}>
                    {s.audit_score.toFixed(2)}
                  </span>
                  <span className="text-xs text-on-surface-variant">
                    {s.audit_last_run ? relTime(s.audit_last_run) : '—'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 6-canonical-task preview grid — 'coming soon' cells */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">
            6-canonical-task eval (v1.1)
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {CANONICAL_TASKS.map((t) => (
            <div
              key={t.key}
              className="rounded-lg border border-dashed border-outline-variant/50 bg-surface-container/40 px-3 py-3 text-center"
            >
              <div className="mb-1 text-xs font-medium">{t.label}</div>
              <div className="text-[10px] uppercase tracking-wide text-on-surface-variant">Soon</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
