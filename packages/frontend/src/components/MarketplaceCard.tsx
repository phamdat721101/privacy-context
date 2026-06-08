'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTier } from '@/hooks/useTier';

/**
 * MarketplaceCard — discriminated-union card for the tri-marketplace.
 *
 * Four product types share one `ProductRoot` shape on Sui (workflow.move /
 * skill.move / reflective.move / brain_registry.move). The card is the
 * UI mirror of that pattern.
 *
 * G1 UX (Adjustment 4): clicks on Sui-only product types from a Standard-tier
 * wallet open a "Switch to Sui" prompt instead of routing to the resource —
 * keeps the catalog browsable from any tier but the action gated cleanly.
 */
export type MarketplaceCardType = 'brain' | 'skill' | 'workflow' | 'reflective';

export interface MarketplaceCardProps {
  type: MarketplaceCardType;
  id: string | number;
  title: string;
  description?: string;
  priceUsdc: string;
  /** brain: tag list. skill: latency hint. workflow: step count. reflective: license duration. */
  meta?: {
    stepCount?: number;
    runs?: number;
    successRate?: number;
    tags?: string[];
    /** Marketplace v1 domain tag (PRD-A). */
    domain?: 'marketing' | 'finance' | 'research' | 'engineering' | 'generalist' | 'other';
    /** Marketplace v1 verification tier (PRD-A). */
    verification_tier?: 'basic' | 'verified' | 'tee_attested';
    licensesSold?: number;
    /** When set, card shows a "Tatum-verified" badge — auditor can verify via /sovereignty-proof. */
    suiObjectId?: string;
  };
}

const TYPE_THEME: Record<MarketplaceCardType, { icon: string; color: string; verb: string; suiOnly: boolean }> = {
  brain:      { icon: 'psychology',     color: 'text-primary',   verb: 'Ask',     suiOnly: false }, // works on Standard tier too
  skill:      { icon: 'build',          color: 'text-tertiary',  verb: 'Invoke',  suiOnly: true  },
  workflow:   { icon: 'account_tree',   color: 'text-secondary', verb: 'Run',     suiOnly: true  },
  reflective: { icon: 'auto_awesome',   color: 'text-amber-500', verb: 'License', suiOnly: true  },
};

export function MarketplaceCard(props: MarketplaceCardProps) {
  const router = useRouter();
  const { tier, setTier } = useTier();
  const [showSwitch, setShowSwitch] = useState(false);
  const theme = TYPE_THEME[props.type];

  const targetHref =
    props.type === 'brain' ? `/agent/${props.id}` :
    props.type === 'workflow' ? `/marketplace?type=workflow&id=${props.id}` :
    props.type === 'skill' ? `/marketplace?type=skill&id=${props.id}` :
    `/marketplace?type=reflective&id=${props.id}`;

  const onClick = (e: React.MouseEvent) => {
    if (theme.suiOnly && tier !== 'trustless') {
      e.preventDefault();
      setShowSwitch(true);
    }
  };

  return (
    <>
      <Link
        href={targetHref}
        onClick={onClick}
        className="encryption-glow group flex h-full flex-col gap-3 rounded-xl border border-outline-variant/30 bg-surface p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 ${theme.color}`}>
            <span className="material-symbols-outlined text-[20px]">{theme.icon}</span>
          </div>
          <span className="inline-flex flex-wrap items-center justify-end gap-1">
            <span className="inline-flex items-center gap-1 rounded-full border border-outline-variant/40 bg-surface-variant/40 px-2 py-0.5 font-mono text-[10px] uppercase text-on-surface-variant">
              {props.type}
            </span>
            {props.meta?.domain && (
              <span className="matrix-chip rounded px-1.5 py-0.5 font-mono text-[10px] uppercase">
                {props.meta.domain}
              </span>
            )}
            {props.meta?.verification_tier && props.meta.verification_tier !== 'basic' && (
              <span className="inline-flex items-center gap-0.5 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-primary">
                <span className="material-symbols-outlined text-[12px]" aria-hidden>verified</span>
                {props.meta.verification_tier === 'tee_attested' ? 'TEE' : 'Verified'}
              </span>
            )}
          </span>
        </div>

        <div className="space-y-1">
          <h3 className="font-headline text-base font-semibold leading-snug text-on-surface group-hover:text-primary">
            {props.title}
          </h3>
          {props.description ? (
            <p className="line-clamp-2 text-sm text-on-surface-variant">{props.description}</p>
          ) : null}
        </div>

        {/* Type-specific meta line */}
        <div className="mt-auto flex items-center justify-between text-xs text-on-surface-variant">
          <div className="flex items-center gap-2">
            {props.type === 'workflow' && props.meta?.stepCount !== undefined && (
              <span>{props.meta.stepCount} steps</span>
            )}
            {props.type === 'workflow' && props.meta?.runs !== undefined && (
              <span>· {props.meta.runs} runs</span>
            )}
            {props.type === 'reflective' && props.meta?.licensesSold !== undefined && (
              <span>{props.meta.licensesSold} licenses sold</span>
            )}
            {props.type === 'brain' && props.meta?.tags?.[0] && (
              <span>{props.meta.tags.slice(0, 2).join(' · ')}</span>
            )}
          </div>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-primary">
            ${Number(props.priceUsdc).toFixed(2)} · {theme.verb}
          </span>
        </div>

        {theme.suiOnly && (
          <div className="-mb-1 -mt-1 flex w-fit flex-wrap items-center gap-1">
            <span className="inline-flex items-center gap-1 rounded-full border border-secondary/30 bg-secondary/10 px-2 py-0.5 font-mono text-[10px] text-secondary">
              <span className="material-symbols-outlined text-[12px]">hub</span>
              Sui-native
            </span>
            {props.meta?.suiObjectId ? (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-500"
                title={`Tatum can verify Sui object ${props.meta.suiObjectId.slice(0, 10)}…`}
              >
                <span className="material-symbols-outlined text-[12px]">verified</span>
                Tatum-verified
              </span>
            ) : null}
          </div>
        )}
      </Link>

      {showSwitch && (
        <SwitchToSuiPrompt
          productType={props.type}
          onClose={() => setShowSwitch(false)}
          onSwitch={() => {
            setTier('trustless');
            setShowSwitch(false);
            // Tier change triggers re-render; Link href stays valid.
            router.push(targetHref);
          }}
        />
      )}
    </>
  );
}

/**
 * SwitchToSuiPrompt — Adjustment 4 (G1) UX. Inline modal triggered when a
 * Standard-tier wallet clicks a Sui-only product. Keeps catalog discovery
 * open while making the network requirement explicit.
 */
function SwitchToSuiPrompt({
  productType,
  onClose,
  onSwitch,
}: {
  productType: MarketplaceCardType;
  onClose: () => void;
  onSwitch: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-w-md rounded-xl border border-outline-variant/40 bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-on-surface">
          <span className="material-symbols-outlined text-[18px] text-secondary">hub</span>
          This {productType} runs on Sui
        </div>
        <p className="mb-4 text-sm text-on-surface-variant">
          {productType === 'workflow'
            ? 'Workflows are signed multi-step DAGs paid in Sui-USDC per execution.'
            : productType === 'skill'
              ? 'Skills are single-tool products paid in Sui-USDC per call.'
              : 'Reflective traces are agent metacognition licenses paid in Sui-USDC.'}
          {' '}Switch network to continue. Your Standard-tier brain access stays unchanged.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-outline-variant/40 px-3 py-1.5 text-sm text-on-surface-variant"
          >
            Cancel
          </button>
          <button
            onClick={onSwitch}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm text-on-primary"
          >
            Switch to Sui
          </button>
        </div>
      </div>
    </div>
  );
}
