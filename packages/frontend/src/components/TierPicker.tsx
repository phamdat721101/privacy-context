'use client';

/**
 * TierPicker — explicit Standard vs Trustless tier picker for /brain/new.
 *
 * Renders two cards: Standard (Fhenix on Arbitrum) and Trustless (Sui +
 * Walrus + SEAL + Phala TEE). User selection persists via the existing
 * `useTier` hook (URL ?tier=… + localStorage).
 *
 * Trade-offs surfaced to the user (per `gap-analysis-and-build-plan.md` §2
 * 5-anchor matrix): cost/year, sovereignty proof availability, ecosystem,
 * proof primitive. No marketing copy — facts only.
 *
 * SOLID: Single Responsibility — this component renders + selects. The
 * downstream publish wizard reads `useTier()` to branch its server calls;
 * this component knows nothing about the publish flow itself.
 */

import { useTier, type Tier } from '@/hooks/useTier';

interface TierFacts {
  id: Tier;
  name: string;
  chain: string;
  storage: string;
  cost: string;
  proof: string;
  payment: string;
  ecosystem: string;
  badge?: string;
}

const TIERS: TierFacts[] = [
  {
    id: 'standard',
    name: 'Standard',
    chain: 'Arbitrum (Fhenix CoFHE)',
    storage: 'Postgres + AES-256-GCM',
    cost: '~$0.115/GB/mo',
    proof: 'On-chain FHE-wrapped key (BrainKeyVaultV2)',
    payment: 'x402 + USDC on Base Sepolia',
    ecosystem: 'EVM agents, ERC-8004 KYA',
  },
  {
    id: 'trustless',
    name: 'Trustless',
    chain: 'Sui + Walrus + SEAL',
    storage: 'Walrus Quilt blobs (decentralized)',
    cost: '~$0.028/year forever',
    proof: 'Sui Move policy + sovereignty-proof endpoint',
    payment: 'Sui-USDC native (1-tx settle)',
    ecosystem: 'Sui agents, MemWal-compatible verbs',
    badge: 'Recommended for new brains',
  },
];

export function TierPicker({
  onPick,
}: {
  /** Called with the tier the user just selected. */
  onPick?: (tier: Tier) => void;
}) {
  const { tier: current, setTier } = useTier();

  const select = (t: Tier) => {
    setTier(t);
    onPick?.(t);
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {TIERS.map((t) => {
        const selected = current === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => select(t.id)}
            aria-pressed={selected}
            className={[
              'text-left rounded-2xl border p-5 transition focus:outline-none',
              selected
                ? 'border-blue-500 bg-blue-50 shadow ring-2 ring-blue-300'
                : 'border-gray-200 bg-white hover:border-gray-400',
            ].join(' ')}
          >
            <div className="flex items-baseline justify-between">
              <h3 className="text-lg font-semibold text-gray-900">{t.name}</h3>
              {t.badge ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                  {t.badge}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-gray-500">{t.chain}</p>
            <dl className="mt-4 space-y-2 text-sm">
              <Row k="Storage" v={t.storage} />
              <Row k="Cost" v={t.cost} />
              <Row k="Trust proof" v={t.proof} />
              <Row k="Payment" v={t.payment} />
              <Row k="Ecosystem" v={t.ecosystem} />
            </dl>
          </button>
        );
      })}
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
