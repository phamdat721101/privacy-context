'use client';

/**
 * MemWalBrainCard — single card for a published MemWal-tier brain.
 *
 * Used in: /marketplace (grid), brain detail header, dashboard recommendations.
 * Mirror of mem-ui `openx_sui_marketplace` card shape — holographic edge,
 * dark-glass panel, cognitive-level + attestation badges, price chip.
 *
 * Responsive: mobile = full width, tablet = 50%, desktop = 33% (parent grid).
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

export interface MemWalBrainSummary {
  sui_object_id: string;
  seller_wallet: string;
  namespace: string;
  title: string;
  description?: string;
  price_per_query_usdc: string | number;
  cognitive_level: number;
  kya_required: boolean;
  attestation_required: number; // 0 none, 1 phala-tee, 2 fhe-envelope
}

const LEVEL_LABEL: Record<number, { label: string; color: string }> = {
  1: { label: 'L1 · episodic', color: 'text-sky-300 border-sky-300/40 bg-sky-300/5' },
  2: { label: 'L2 · semantic', color: 'text-emerald-300 border-emerald-300/40 bg-emerald-300/5' },
  3: { label: 'L3 · long-term', color: 'text-violet-300 border-violet-300/40 bg-violet-300/5' },
  4: { label: 'L4 · workflow', color: 'text-amber-300 border-amber-300/40 bg-amber-300/5' },
  5: { label: 'L5 · reflective', color: 'text-rose-300 border-rose-300/40 bg-rose-300/5' },
};

function attestationBadge(att: number): ReactNode {
  if (att === 1) return <Chip color="text-secondary border-secondary/30 bg-secondary/5">Phala TEE</Chip>;
  if (att === 2) return <Chip color="text-tertiary border-tertiary/30 bg-tertiary/5">FHE-encrypted</Chip>;
  return null;
}

function Chip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${color}`}
    >
      {children}
    </span>
  );
}

export function MemWalBrainCard({ brain }: { brain: MemWalBrainSummary }) {
  const lvl = LEVEL_LABEL[brain.cognitive_level] ?? LEVEL_LABEL[3];
  const price = Number(brain.price_per_query_usdc);
  return (
    <Link
      href={`/marketplace/${brain.sui_object_id}`}
      className="group flex flex-col gap-3 rounded-lg border border-outline-variant/40 bg-surface-container-low/60 p-4 backdrop-blur transition hover:border-primary/40 hover:shadow-glow-cyan"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded border border-outline-variant/40 bg-surface">
          <span className="material-symbols-outlined text-primary text-[20px]">psychology</span>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          <Chip color={lvl.color}>{lvl.label}</Chip>
          {attestationBadge(brain.attestation_required)}
          {brain.kya_required && <Chip color="text-amber-300 border-amber-300/30 bg-amber-300/5">KYA</Chip>}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="font-headline text-base font-semibold text-on-surface line-clamp-2">{brain.title}</h3>
        <p className="text-xs text-on-surface-variant line-clamp-2 group-hover:line-clamp-3 transition-all">
          {brain.description || 'No description.'}
        </p>
      </div>
      <div className="mt-auto flex items-end justify-between border-t border-outline-variant/30 pt-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">namespace</span>
          <span className="font-mono text-xs text-on-surface-variant truncate max-w-[140px]">{brain.namespace}</span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">per query</span>
          <span className="font-mono text-sm text-primary">${price.toFixed(price < 0.01 ? 4 : 2)}</span>
        </div>
      </div>
    </Link>
  );
}
