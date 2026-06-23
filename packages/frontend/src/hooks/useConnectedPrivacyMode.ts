'use client';

/**
 * useConnectedPrivacyMode — wizard privacy-posture detector.
 *
 * PRD-F: post-FHE strip there are two modes — `metadata-only` (chain
 * metadata is public but agent inputs aren't logged) and `off` (everything
 * is public). Default is `off`; `metadata-only` is opt-in for sellers who
 * want a softer disclosure surface.
 *
 * SOLID:
 *  - SRP: derive privacy mode from connected network + manual override.
 *  - DIP: no SDK coupling — `PrivacyMode` is owned here (canonical) and
 *    re-imported by callers. The deleted Fhenix-era detection algorithm
 *    isn't needed anymore (every supported EVM network maps to `off`).
 */

import { useMemo, useState } from 'react';
import { useNetwork } from './useNetwork';

export type PrivacyMode = 'metadata-only' | 'off';

export interface NetworkDetectResult {
  mode: PrivacyMode;
  /** Why this mode was selected (UI surface). */
  reason: 'override' | 'default';
  /** Detection source — 'auto' for default, 'manual' for override. */
  source: 'auto' | 'manual';
  /** Cosmetic tier label for the wizard's privacy card. */
  tier: 'standard';
}

export interface UseConnectedPrivacyMode {
  detected: NetworkDetectResult;
  override: PrivacyMode | undefined;
  setOverride: (m: PrivacyMode | undefined) => void;
  /** Numeric chain id — passed to publish API as `privacy.chain_id`. */
  chainId: number | undefined;
}

export function useConnectedPrivacyMode(): UseConnectedPrivacyMode {
  const { network } = useNetwork();
  const [override, setOverride] = useState<PrivacyMode | undefined>(undefined);

  const { detected, chainId } = useMemo(() => {
    const mode: PrivacyMode = override ?? 'off';
    return {
      detected: {
        mode,
        reason: override ? ('override' as const) : ('default' as const),
        source: override ? ('manual' as const) : ('auto' as const),
        tier: 'standard' as const,
      },
      chainId: network.id,
    };
  }, [network, override]);

  return { detected, override, setOverride, chainId };
}
