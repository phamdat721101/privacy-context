/**
 * networkDetect — pure-function privacy-mode detection from connected
 * wallet. Single chain after Sui-removal: every Fhenix-supported EVM
 * network maps to mode='fhe'. Manual override still wins.
 *
 * SOLID:
 *   - SRP: chain-id → PrivacyMode.
 *   - OCP: extending to a new EVM chain = one entry in FHENIX_CHAIN_IDS.
 */

import type { PrivacyMode, PrivacySource, PrivacyTier } from './types';
import { privacyTierFor } from './types';

export interface NetworkDetectInput {
  /** wagmi `useChainId()` — numeric EVM chain id; undefined when not connected. */
  evmChainId?: number;
  /** Manual override from the wizard's collapsed picker. Always wins. */
  manualOverride?: PrivacyMode;
}

export interface NetworkDetectResult {
  mode: PrivacyMode;
  tier: PrivacyTier;
  source: PrivacySource;
  reason: string;
  chainId?: number;
}

const FHENIX_CHAIN_IDS = new Set<number>([
  421614, // Arbitrum Sepolia (current testnet)
  42161, // Arbitrum One (mainnet)
  84532, // Base Sepolia
  1, // Ethereum mainnet
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
    reason: 'no recognized network connected; defaulting to encrypted',
  };
}
