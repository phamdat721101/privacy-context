/**
 * Privacy types — extended for seller-first marketplace v2.
 *
 * Backward-compatible: existing 'fhe' | 'metadata-only' | 'off' modes
 * stay; 'seal_walrus' is added for the Sui Trustless tier (Seal IBE +
 * Walrus + MemWal). Also adds the human-facing PrivacyTier and the
 * detection-source field used by the network-aware router (PRD-16).
 *
 * SOLID:
 *   - Types are the public contract. No runtime code in this file.
 *   - The router (privacyModeRouter.ts) and detector (networkDetect.ts)
 *     read these types; UI badges (PrivacyBadge.tsx) derive labels
 *     from `tier`, never from raw `mode`.
 */

export type PrivacyMode = 'fhe' | 'seal_walrus' | 'metadata-only' | 'off';

/**
 * Human-facing two-tier label. Maps:
 *   'fhe'           → 'standard'
 *   'seal_walrus'   → 'trustless'
 *   'metadata-only' → 'standard'
 *   'off'           → 'standard'
 */
export type PrivacyTier = 'standard' | 'trustless';

/**
 * Whether the mode was auto-detected from the connected wallet's network
 * or manually picked by the seller via the wizard's override radio.
 */
export type PrivacySource = 'auto' | 'manual';

export interface PrivacyConfig {
  mode: PrivacyMode;
  tier?: PrivacyTier;
  source?: PrivacySource;
  metadataFilter?: boolean;
  contextEncryption?: boolean;
}

/** Pure projection — no runtime side-effects. */
export function privacyTierFor(mode: PrivacyMode): PrivacyTier {
  return mode === 'seal_walrus' ? 'trustless' : 'standard';
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
