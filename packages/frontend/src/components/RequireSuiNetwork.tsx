'use client';

/**
 * RequireSuiNetwork — single guard component for MemWal-only surfaces.
 *
 * Use as a route-level wrapper (`<RequireSuiNetwork>{children}</RequireSuiNetwork>`)
 * or as an inline gate around MemWal-tier widgets (e.g. a tier=memwal card).
 *
 * Why this lives in one file:
 *   • Network gating logic is centralized — pages don't repeat `useNetwork()`
 *     comparisons. SOLID-SRP.
 *   • The empty-state copy + CTA matches the mem-ui "switched_to_sui_moment"
 *     prototype. Two consumers share one component.
 *   • Backend mirror lives at `packages/api/src/middleware/require-sui-wallet.ts`
 *     and is the authoritative G2 server-side gate. This file is only UX.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useNetwork } from '@/hooks/useNetwork';
import { isSuiNetwork } from '@/lib/networks';

interface RequireSuiNetworkProps {
  children: ReactNode;
  /** Override the default empty-state title. */
  title?: string;
  /** Override the default empty-state description. */
  description?: string;
}

const DEFAULT_TITLE = 'Switch to Sui to access MemWal';
const DEFAULT_DESCRIPTION =
  'OpenX × Walrus Memory features run on Sui. Switch your active network to enable per-query brain billing, the MCP gateway, and three-proof verification.';

export function RequireSuiNetwork({
  children,
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
}: RequireSuiNetworkProps) {
  const { network, ready } = useNetwork();

  // Avoid hydration flicker — render nothing until persisted state is loaded.
  if (!ready) return null;

  if (isSuiNetwork(network)) return <>{children}</>;

  return <SwitchToSuiPrompt title={title} description={description} />;
}

/**
 * Standalone empty-state. Exported so other surfaces (e.g. a marketplace
 * tier=memwal filter chip) can render the same UX without wrapping children.
 */
export function SwitchToSuiPrompt({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
}: { title?: string; description?: string }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-lg border border-outline-variant/40 bg-surface-container-low/60 p-8 text-center backdrop-blur">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-primary/40 bg-primary/5">
        <span className="material-symbols-outlined text-primary text-[28px]">water_drop</span>
      </div>
      <h2 className="font-headline text-xl font-semibold text-on-surface">{title}</h2>
      <p className="text-sm text-on-surface-variant">{description}</p>
      <Link
        href="/settings#networks"
        className="mt-2 inline-flex items-center gap-2 rounded border border-primary bg-primary/10 px-4 py-2 font-mono text-xs uppercase tracking-wider text-primary transition hover:bg-primary/20"
      >
        <span className="material-symbols-outlined text-[16px]">swap_horiz</span>
        Switch to Sui Testnet
      </Link>
      <p className="font-mono text-[11px] uppercase tracking-widest text-outline">
        G1 isolation — no Sui-tier features fire on EVM networks
      </p>
    </div>
  );
}
