/**
 * Privacy types — Arbitrum/Fhenix-only after the v2.0 Sui-removal relaunch.
 *
 * Single tier ('standard' = Fhenix CoFHE on Arbitrum). The 'trustless'
 * tier (Seal + Walrus on Sui) is removed; PrivacyTier is kept as a single-
 * value type so existing UI badges + hooks compile byte-identically.
 *
 * SOLID: types only — no runtime code in this file.
 */

export type PrivacyMode = 'fhe' | 'metadata-only' | 'off';

/** Human-facing tier label. Single value post-Sui-removal. */
export type PrivacyTier = 'standard';

/** Whether the mode was auto-detected from the connected wallet's network
 *  or manually picked by the seller via the wizard's override radio. */
export type PrivacySource = 'auto' | 'manual';

export interface PrivacyConfig {
  mode: PrivacyMode;
  tier?: PrivacyTier;
  source?: PrivacySource;
  metadataFilter?: boolean;
  contextEncryption?: boolean;
}

/** Pure projection — every supported mode maps to the standard tier. */
export function privacyTierFor(_mode: PrivacyMode): PrivacyTier {
  return 'standard';
}

export interface FilteredMetadata {
  original: string;
  filtered: string;
  redactedFields: string[];
  piiCount: number;
}

export interface SealedPaymentEvent {
  protocol: string;
  chain: string;
  timestamp: number;
  encrypted: {
    urlHash?: `0x${string}`;
    durationMs?: `0x${string}`;
    success?: `0x${string}`;
  };
}

export interface PaymentEvent {
  protocol: string;
  chain: string;
  timestamp: number;
  url: string;
  durationMs: number;
  success: boolean;
  error?: string;
}
