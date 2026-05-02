export type PrivacyMode = 'fhe' | 'metadata-only' | 'off';

export interface PrivacyConfig {
  mode: PrivacyMode;
  metadataFilter?: boolean;
  contextEncryption?: boolean;
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
