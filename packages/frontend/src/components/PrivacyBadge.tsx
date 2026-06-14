'use client';

import Link from 'next/link';

/**
 * PrivacyBadge — buyer-side trust signal. Single-tier post-Sui-removal:
 * every published brain is FHE-encrypted on Arbitrum. Renders one of two
 * badges:
 *   'fhe'           → "End-to-end encrypted"  (primary chip)
 *   'metadata-only' → "Metadata redacted"     (subtle outline)
 *   'off'           → null
 *
 * SOLID: render-only. No fetch, no state.
 */

import type { PrivacyMode } from '@fhe-ai-context/sdk';

interface BadgeSpec {
  label: string;
  tooltip: string;
  className: string;
}

const BADGES: Record<Exclude<PrivacyMode, 'off'>, BadgeSpec> = {
  fhe: {
    label: 'End-to-end encrypted',
    tooltip:
      'Knowledge stays encrypted on the server. The encryption key is held in a smart contract you control — only paid users can read answers.',
    className:
      'border-[var(--color-surface-tint,_#00dbe9)] bg-[color-mix(in_oklab,_#00dbe9_8%,_transparent)] text-[var(--color-primary,_#dbfcff)]',
  },
  'metadata-only': {
    label: 'Metadata redacted',
    tooltip: 'PII fields are regex-redacted before storage. Plaintext content otherwise.',
    className: 'border-outline-variant/40 bg-surface-container-low text-on-surface-variant',
  },
};

export function PrivacyBadge({ mode }: { mode: PrivacyMode }) {
  if (mode === 'off') return null;
  const spec = BADGES[mode];
  if (!spec) return null;
  return (
    <span
      title={spec.tooltip}
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${spec.className}`}
    >
      {spec.label}
    </span>
  );
}

// Re-export Link so wider modules can import a single namespace if they
// want to keep imports tight; otherwise unused.
export { Link };
