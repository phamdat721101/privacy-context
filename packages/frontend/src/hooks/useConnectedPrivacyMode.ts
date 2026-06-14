'use client';

/**
 * useConnectedPrivacyMode — wizard detector. Single-chain post-Sui-removal:
 * every supported network is EVM (Arbitrum + Base) and maps to mode='fhe'.
 *
 * SOLID:
 *  - SRP: derive privacy from active network + manual override.
 *  - DIP: detection algorithm lives in `@fhe-ai-context/sdk` (pure fn).
 */

import { useMemo, useState } from 'react';
import {
  detectPrivacyMode,
  type NetworkDetectResult,
  type PrivacyMode,
} from '@fhe-ai-context/sdk';
import { useNetwork } from './useNetwork';

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
    return {
      detected: detectPrivacyMode({
        evmChainId: network.id,
        manualOverride: override,
      }),
      chainId: network.id,
    };
  }, [network, override]);

  return { detected, override, setOverride, chainId };
}
