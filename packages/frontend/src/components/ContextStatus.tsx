'use client';
import { MemoryTierBadge } from './MemoryTierBadge';

const TRUST_LABELS = ['Anonymous', 'Basic', 'Premium', 'Admin'];

interface Props {
  trustLevel?: number;
  memoryTier?: number;
  isVerified?: boolean;
}

export function ContextStatus({ trustLevel, memoryTier, isVerified }: Props) {
  return (
    <div className="flex items-center gap-3 text-sm text-gray-300">
      <span>Trust: <strong>{TRUST_LABELS[trustLevel ?? 0]}</strong></span>
      {memoryTier !== undefined && <MemoryTierBadge tier={memoryTier} />}
      {isVerified && <span className="text-green-400 font-semibold">KYC Verified</span>}
    </div>
  );
}
