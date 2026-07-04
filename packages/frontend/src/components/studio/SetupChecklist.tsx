'use client';

/**
 * SetupChecklist — score bar + step list. Toku-inspired pattern for
 * PRD-V V2 Overview. Steps whose `href` is set render as inline "Fix"
 * links; unrelated steps are info-only.
 *
 * SOLID:
 *   • SRP — display + link-out only. Server owns "done" state; UI never
 *          mutates it locally.
 */

import Link from 'next/link';

export interface SetupChecklistStep {
  key: string;
  label: string;
  done: boolean;
  href?: string;
}

interface SetupChecklistProps {
  score: number;
  ready: boolean;
  steps: SetupChecklistStep[];
  className?: string;
}

export function SetupChecklist({ score, ready, steps, className }: SetupChecklistProps): JSX.Element {
  const barColor = ready ? 'bg-secondary' : score >= 60 ? 'bg-primary' : 'bg-tertiary';
  return (
    <div
      className={`rounded-2xl border border-outline-variant/40 bg-surface-container-low p-5 ${className ?? ''}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-headline text-sm font-semibold">Setup checklist</h3>
        <span className={`text-xs font-medium ${ready ? 'text-secondary' : 'text-on-surface-variant'}`}>
          {ready ? 'Ready to sell' : `${score}%`}
        </span>
      </div>
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-surface-container">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${score}%` }} />
      </div>
      <ul className="space-y-2">
        {steps.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className={`inline-block h-4 w-4 shrink-0 rounded-full border ${
                  s.done ? 'border-secondary bg-secondary text-on-secondary' : 'border-outline-variant'
                }`}
              >
                {s.done && (
                  <svg viewBox="0 0 16 16" className="h-full w-full" fill="none">
                    <path d="M4 8l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className={s.done ? 'text-on-surface-variant line-through' : ''}>{s.label}</span>
            </div>
            {!s.done && s.href && (
              <Link href={s.href} className="text-xs font-medium text-primary hover:underline">
                Fix →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
