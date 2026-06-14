'use client';

/**
 * useNetwork — single-chain post-Sui-removal. Returns the canonical
 * Arbitrum Sepolia network. Kept as a hook so existing call-sites compile;
 * the persistence/url-sync logic the multi-chain world needed is gone.
 *
 * SOLID: SRP — return the active network. Nothing else.
 */

import { getNetworkByKey, type Network, type NetworkKey } from '@/lib/networks';

export interface UseNetworkResult {
  network: Network;
  networkKey: NetworkKey;
  setNetworkKey: (_key: NetworkKey) => void;
  ready: boolean;
}

const DEFAULT_NETWORK = getNetworkByKey('arbitrum-sepolia');

export function useNetwork(): UseNetworkResult {
  return {
    network: DEFAULT_NETWORK,
    networkKey: DEFAULT_NETWORK.key,
    setNetworkKey: () => {
      /* no-op — single chain post-relaunch */
    },
    ready: true,
  };
}
