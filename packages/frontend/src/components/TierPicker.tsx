'use client';

/**
 * TierPicker — single-tier post-Sui-removal.
 *
 * Renders one informational card describing the privacy stack (Fhenix CoFHE
 * + AES-256-GCM client-side). Kept as a component so existing call sites
 * (`/brain/new`) compile; the multi-tier picker UI is gone.
 *
 * SOLID: SRP — render the privacy promise. No state, no side effects.
 */

import { useEffect } from 'react';
import type { Tier } from '@/hooks/useTier';

const FACTS = {
  name: 'Encrypted by default',
  storage: 'Encrypted at rest in Postgres + AES-256-GCM',
  cost: 'Fixed per-task pricing — no subscriptions',
  proof: 'Privacy lock held in a smart contract you can revoke any time',
  payment: 'Pay $0.50–$5 per task',
  ecosystem: 'Works with Claude, Cursor, Codex, custom AI assistants',
};

export function TierPicker({ onPick }: { onPick?: (tier: Tier) => void }) {
  // Auto-select standard once on mount — keeps callers (e.g. publish wizard)
  // that expect a tier selection compiling. Effect avoids the SSR `router.push`
  // crash that synchronous onPick caused during static prerender.
  useEffect(() => {
    if (onPick) onPick('standard');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold text-gray-900">{FACTS.name}</h3>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
          Default
        </span>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Your knowledge pack stays encrypted end-to-end. Only paid users can read answers.
      </p>
      <dl className="mt-4 space-y-2 text-sm">
        <Row k="Storage" v={FACTS.storage} />
        <Row k="Pricing" v={FACTS.cost} />
        <Row k="Privacy" v={FACTS.proof} />
        <Row k="Payment" v={FACTS.payment} />
        <Row k="Works with" v={FACTS.ecosystem} />
      </dl>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-gray-500">{k}</dt>
      <dd className="text-right text-gray-900">{v}</dd>
    </div>
  );
}
