'use client';

/**
 * DreamDiffReview — one diff card for PRD-V V5.
 *
 * Renders old_text vs new_text with rationale + predicted_eval_delta.
 * A checkbox lets the parent page batch approvals within one run — the
 * parent collects the selected diff IDs + issues ONE EIP-712 signature
 * covering all selections.
 *
 * SOLID:
 *   • SRP — display + checkbox only. Signing + POST live in the parent
 *          V5 page which owns the sign-and-apply UX.
 */

export interface DreamDiffCard {
  diff_id: string;
  target_kind: 'skill' | 'persona' | string;
  target_ref: string;
  operation: 'add' | 'edit' | 'delete' | 'merge' | string;
  old_text: string | null;
  new_text: string;
  rationale: string;
  predicted_eval_delta: number;
  status: 'pending' | 'approved' | 'rejected' | 'superseded' | string;
}

interface Props {
  diff: DreamDiffCard;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  disabled?: boolean;
}

const OP_LABEL: Record<string, string> = {
  add: '+ Add',
  edit: '~ Edit',
  merge: '⇢ Merge',
  delete: '− Delete',
};

export function DreamDiffReview({ diff, selected, onSelectedChange, disabled }: Props): JSX.Element {
  const nonPending = diff.status !== 'pending';
  return (
    <div
      className={`rounded-2xl border p-5 transition ${
        nonPending
          ? 'border-outline-variant/20 bg-surface-container-low/40 opacity-60'
          : selected
          ? 'border-primary/60 bg-primary/5'
          : 'border-outline-variant/40 bg-surface-container-low'
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-tertiary/10 px-2 py-0.5 text-[10px] font-medium text-tertiary">
              {OP_LABEL[diff.operation] ?? diff.operation}
            </span>
            <span className="font-mono text-xs">
              {diff.target_kind}/{diff.target_ref}
            </span>
          </div>
          <div className="mt-1 text-xs text-on-surface-variant">{diff.rationale}</div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="rounded-full bg-secondary/10 px-3 py-1 text-xs">
            Δ eval:{' '}
            <span className={diff.predicted_eval_delta >= 0 ? 'text-secondary' : 'text-error'}>
              {diff.predicted_eval_delta >= 0 ? '+' : ''}
              {(diff.predicted_eval_delta * 100).toFixed(1)}%
            </span>
          </div>
          {!nonPending && (
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={selected}
                onChange={(e) => onSelectedChange(e.target.checked)}
                disabled={disabled}
                className="h-4 w-4 rounded border-outline-variant text-primary"
              />
              <span>Apply</span>
            </label>
          )}
          {nonPending && (
            <span className="rounded-full bg-surface-container px-2 py-0.5 text-[10px] uppercase tracking-wide text-on-surface-variant">
              {diff.status}
            </span>
          )}
        </div>
      </div>

      {/* Old / New side by side */}
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-on-surface-variant">
            Before
          </div>
          <pre className="max-h-40 overflow-auto rounded-lg border border-outline-variant/30 bg-surface-container/40 p-3 font-mono text-[11px]">
            {diff.old_text?.trim() || '(new — no prior version)'}
          </pre>
        </div>
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-primary">After</div>
          <pre className="max-h-40 overflow-auto rounded-lg border border-primary/30 bg-primary/5 p-3 font-mono text-[11px]">
            {diff.new_text.trim()}
          </pre>
        </div>
      </div>
    </div>
  );
}
