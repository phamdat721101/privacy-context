'use client';

/**
 * useTier — single-tier post-Sui-removal.
 *
 * Every published brain is now Fhenix CoFHE on Arbitrum (the historical
 * "standard" tier). The hook stays so existing callers compile; it always
 * returns `'standard'`. `setTier` is a no-op.
 */

export type Tier = 'standard';

export function useTier(): { tier: Tier; setTier: (_t: Tier) => void } {
  return {
    tier: 'standard',
    setTier: () => {
      /* no-op — single tier post-relaunch */
    },
  };
}
