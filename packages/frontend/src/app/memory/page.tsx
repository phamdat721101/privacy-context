'use client';
import { useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { BottomNav } from '@/components/BottomNav';

const TIERS = [
  {
    icon: '⚡',
    label: 'SHORT-TERM',
    description: 'Last 3 sessions',
    color: 'var(--pixel-teal)',
    fill: 0,
    locked: false,
  },
  {
    icon: '🔵',
    label: 'MEDIUM-TERM',
    description: 'Last 30 days',
    color: 'var(--pixel-gold)',
    fill: 0,
    locked: false,
  },
  {
    icon: '🟣',
    label: 'LONG-TERM',
    description: 'Reach LVL 3 to unlock',
    color: 'var(--pixel-gray)',
    fill: 0,
    locked: true,
  },
];

export default function MemoryPage() {
  const { authenticated, ready } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && !authenticated) router.push('/');
  }, [ready, authenticated, router]);

  if (!ready || !authenticated) return null;

  return (
    <main className="page-container min-h-screen pb-28 px-4 py-4 space-y-4" style={{ background: 'var(--pixel-black)' }}>
      {/* Header */}
      <div>
        <h1 style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: 'var(--pixel-red)', textShadow: '2px 2px 0 var(--pixel-gold)' }}>
          MEMORY VAULT
        </h1>
        <div className="mt-1">
          <span className="pixel-badge" style={{ color: 'var(--pixel-teal)', fontSize: '11px' }}>
            🔒 ALL ENCRYPTED ON-CHAIN
          </span>
        </div>
      </div>

      <div style={{ fontFamily: "'Press Start 2P'", fontSize: '8px', color: 'var(--pixel-gold)', letterSpacing: '0.1em' }}>
        MEMORY TIERS
      </div>

      {/* Tier Cards */}
      {TIERS.map((tier) => (
        <div key={tier.label} className={tier.locked ? 'pixel-card-gray' : 'pixel-card'} style={tier.locked ? {} : { borderColor: tier.color, boxShadow: `4px 4px 0 ${tier.color}` }}>
          <div className="flex items-center justify-between mb-2">
            <span style={{ fontFamily: "'Press Start 2P'", fontSize: '8px', color: tier.locked ? 'var(--pixel-gray)' : tier.color }}>
              {tier.icon} {tier.label}
            </span>
            {tier.locked && (
              <span className="pixel-badge" style={{ color: 'var(--pixel-gray)', fontSize: '10px' }}>LOCKED</span>
            )}
          </div>

          <div style={{ fontFamily: "'VT323'", fontSize: '14px', color: 'var(--pixel-gray)', marginBottom: '8px' }}>
            {tier.description}
          </div>

          <div className="pixel-progress mb-3" style={{ borderColor: tier.locked ? 'var(--pixel-gray)' : tier.color }}>
            <div
              className="pixel-progress-fill"
              style={{
                width: `${tier.fill}%`,
                background: tier.locked
                  ? 'var(--pixel-gray)'
                  : `repeating-linear-gradient(90deg, ${tier.color} 0px, ${tier.color} 10px, #1a2744 10px, #1a2744 12px)`,
              }}
            />
          </div>

          {!tier.locked && (
            <div className="flex gap-2">
              <button className="pixel-btn pixel-btn-ghost" style={{ fontSize: '12px', padding: '4px 12px' }}>
                VIEW
              </button>
              <button className="pixel-btn pixel-btn-danger" style={{ fontSize: '12px', padding: '4px 12px' }}>
                CLEAR
              </button>
            </div>
          )}
        </div>
      ))}

      {/* Selective Forget */}
      <div className="pixel-card-danger">
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '8px', color: 'var(--pixel-danger)', marginBottom: '8px' }}>
          🗑 SELECTIVE FORGET
        </div>
        <div style={{ fontFamily: "'VT323'", fontSize: '14px', color: 'var(--pixel-gray)', marginBottom: '12px' }}>
          Erase specific sessions from your encrypted memory
        </div>
        <button className="pixel-btn pixel-btn-danger" style={{ fontSize: '12px' }}>
          MANAGE
        </button>
      </div>

      <BottomNav />
    </main>
  );
}
