'use client';

const TIER_LABELS = ['Short-term', 'Medium-term', 'Long-term'];
const TIER_COLORS = ['bg-yellow-600', 'bg-blue-600', 'bg-green-600'];

interface Props { tier: number }

export function MemoryTierBadge({ tier }: Props) {
  const label = TIER_LABELS[tier] ?? 'Unknown';
  const color = TIER_COLORS[tier] ?? 'bg-gray-600';
  return (
    <span className={`${color} text-white text-xs font-semibold px-2 py-1 rounded`}>
      {label}
    </span>
  );
}
