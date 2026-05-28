'use client';

import { useEffect, useState, useCallback } from 'react';

/**
 * Tier picker state. Three tiers (Standard = Fhenix, Trustless = Sui, Memory = Arkiv).
 * The 'arkiv' tier is additive — selecting it does NOT change v2/v3 routes; it just
 * surfaces the /memory page as the primary destination.
 */
export type Tier = 'standard' | 'trustless' | 'arkiv';

const KEY = 'openx:tier';
const VALID: Tier[] = ['standard', 'trustless', 'arkiv'];

function isTier(v: unknown): v is Tier {
  return typeof v === 'string' && (VALID as string[]).includes(v);
}

/**
 * useTier — minimal cross-page tier state.
 *   - Reads ?tier= URL param if present.
 *   - Falls back to localStorage.
 *   - Default: 'standard' (Fhenix/Arbitrum).
 *
 * Per docs/UNIFIED_FLOW_SPEC.md the picker abstraction is the only chain
 * detail visible to humans; agents see chain explicitly via the SDK.
 */
export function useTier(): { tier: Tier; setTier: (t: Tier) => void } {
  const [tier, setTierState] = useState<Tier>('standard');

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const fromUrl = url.searchParams.get('tier');
      if (isTier(fromUrl)) {
        setTierState(fromUrl);
        return;
      }
      const stored = window.localStorage.getItem(KEY);
      if (isTier(stored)) setTierState(stored);
    } catch {
      // SSR / no-window — keep default
    }
  }, []);

  const setTier = useCallback((t: Tier) => {
    setTierState(t);
    try {
      window.localStorage.setItem(KEY, t);
      const url = new URL(window.location.href);
      url.searchParams.set('tier', t);
      window.history.replaceState({}, '', url.toString());
    } catch {
      // ignore
    }
  }, []);

  return { tier, setTier };
}
