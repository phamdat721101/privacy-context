/**
 * networkDetect — pure-function privacy-mode detection from connected
 * wallet network. PRD-16 §4.
 *
 * No I/O, no side effects, no async. The caller (UI hook or API service)
 * passes whatever they know about the connected wallet; we return a
 * structured result the seller wizard can render and the publish service
 * can persist verbatim.
 *
 * SOLID:
 *   - SRP: one job — chain-id → PrivacyMode.
 *   - OCP: extending to a new chain = one entry in FHENIX_CHAIN_IDS or
 *     SUI_CHAIN_IDS; the algorithm is unchanged.
 */

import type {
  PrivacyMode,
  PrivacySource,
  PrivacyTier,
} from './types';
import { privacyTierFor } from './types';

export interface NetworkDetectInput {
  /** wagmi `useChainId()` — numeric EVM chain id; undefined when not connected. */
  evmChainId?: number;
  /** `@mysten/dapp-kit` current chain string, e.g. 'sui:mainnet'. */
  suiChain?: string;
  /** Manual override from the wizard's collapsed picker. Always wins. */
  manualOverride?: PrivacyMode;
}

export interface NetworkDetectResult {
  mode: PrivacyMode;
  tier: PrivacyTier;
  source: PrivacySource;
  reason: string;
  chainId?: number | string;
}

const FHENIX_CHAIN_IDS = new Set<number>([
  421614, // Arbitrum Sepolia (Fhenix CoFHE testnet — current)
  42161,  // Arbitrum One (Fhenix CoFHE mainnet — future)
  84532,  // Base Sepolia
  1,      // Ethereum mainnet
]);

const SUI_CHAIN_IDS = new Set<string>([
  'sui:mainnet',
  'sui:testnet',
  'sui:devnet',
]);

export function detectPrivacyMode(input: NetworkDetectInput): NetworkDetectResult {
  if (input.manualOverride) {
    const mode = input.manualOverride;
    return {
      mode,
      tier: privacyTierFor(mode),
      source: 'manual',
      reason: 'manual override',
    };
  }
  if (input.suiChain && SUI_CHAIN_IDS.has(input.suiChain)) {
    return {
      mode: 'seal_walrus',
      tier: 'trustless',
      source: 'auto',
      reason: `connected to ${input.suiChain}`,
      chainId: input.suiChain,
    };
  }
  if (input.evmChainId && FHENIX_CHAIN_IDS.has(input.evmChainId)) {
    return {
      mode: 'fhe',
      tier: 'standard',
      source: 'auto',
      reason: `connected to chain ${input.evmChainId}`,
      chainId: input.evmChainId,
    };
  }
  return {
    mode: 'fhe',
    tier: 'standard',
    source: 'auto',
    reason: 'no recognized network connected; defaulting to Standard',
  };
}
