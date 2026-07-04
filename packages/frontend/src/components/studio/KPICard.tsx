'use client';

/**
 * KPICard — reusable label + value + optional delta arrow.
 *
 * v1.0 renders the label + big value + optional secondary hint. Sparkline
 * shipping in v1.1 alongside the reputation ingestion cron (needs a time
 * series column that only becomes populated after U6 federation).
 *
 * SOLID:
 *   • SRP — display-only, no fetching.
 */

interface KPICardProps {
  label: string;
  value: string;
  hint?: string;
  /** Positive/negative signal for optional up/down indicator (percent). */
  deltaPct?: number;
  className?: string;
}

export function KPICard({ label, value, hint, deltaPct, className }: KPICardProps): JSX.Element {
  const deltaColor =
    deltaPct === undefined
      ? ''
      : deltaPct >= 0
      ? 'text-secondary'
      : 'text-error';
  const deltaSymbol = deltaPct === undefined ? '' : deltaPct >= 0 ? '↑' : '↓';
  return (
    <div
      className={`rounded-2xl border border-outline-variant/40 bg-surface-container-low p-4 md:p-5 ${
        className ?? ''
      }`}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="font-headline text-2xl font-bold md:text-3xl">{value}</div>
        {deltaPct !== undefined && (
          <div className={`text-xs font-medium ${deltaColor}`}>
            {deltaSymbol} {Math.abs(deltaPct).toFixed(1)}%
          </div>
        )}
      </div>
      {hint && <div className="mt-1 text-xs text-on-surface-variant">{hint}</div>}
    </div>
  );
}
