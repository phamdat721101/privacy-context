'use client';

import { useCallback } from 'react';
import { useNetwork } from './useNetwork';
import { SUPPORTED_NETWORKS, type NetworkKey } from '@/lib/networks';

/**
 * Tier picker state. Two tiers (Standard = Fhenix on Arbitrum, Trustless = Sui).
 *
 * As of the Sui-network rollout, this hook is a **derived selector** over
 * `useNetwork` — there is no separate `openx:tier` localStorage key. Selecting
 * "Trustless" picks the canonical trustless network (Sui Testnet); selecting
 * "Standard" picks the canonical standard network (Arbitrum Sepolia).
 *
 * The public API surface (`{ tier, setTier }`) is preserved so the five
 * existing callers (TierPicker, PublishWizard, agent page, etc.) continue to
 * compile unchanged.
 *
 * SOLID:
 *   - SRP: tier semantics only. Persistence lives in `useNetwork`.
 *   - DIP: tier-to-network mapping comes from the network registry, not
 *     hardcoded strings — adding a new network with `tier: 'trustless'`
 *     automatically widens the selector if needed.
 */
export type Tier = 'standard' | 'trustless';

/** Canonical network per tier — first match in `SUPPORTED_NETWORKS`. */
function defaultKeyForTier(tier: Tier): NetworkKey {
  const match = SUPPORTED_NETWORKS.find((n) => n.tier === tier);
  // Registry guarantees at least one entry per tier; fall back is unreachable
  // but typed safely for callers.
  return (match?.key ?? 'arbitrum-sepolia') as NetworkKey;
}

export function useTier(): { tier: Tier; setTier: (t: Tier) => void } {
  const { network, setNetworkKey } = useNetwork();

  const setTier = useCallback(
    (t: Tier) => {
      // No-op when already on a network of this tier — avoids surprise
      // network changes when the user re-selects the current tier in the
      // TierPicker UI.
      if (network.tier === t) return;
      setNetworkKey(defaultKeyForTier(t));
    },
    [network.tier, setNetworkKey],
  );

  return { tier: network.tier, setTier };
}
