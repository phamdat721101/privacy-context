'use client';
import { useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PermitManager } from '@/components/PermitManager';
import { BottomNav } from '@/components/BottomNav';
import { usePermit } from '@/hooks/usePermit';

export default function SettingsPage() {
  const { authenticated, ready, user, logout } = usePrivy();
  const router = useRouter();
  const addr = user?.wallet?.address;
  const userAddress = addr as `0x${string}` | undefined;
  const { permitState, authorize, revoke, loading: permitLoading, error: permitError } = usePermit(userAddress);

  useEffect(() => {
    if (ready && !authenticated) router.push('/');
  }, [ready, authenticated, router]);

  if (!ready || !authenticated) return null;

  return (
    <main className="page-container min-h-screen pb-20 px-4 py-4 space-y-4" style={{ background: 'var(--pixel-black)' }}>
      <h1 style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: 'var(--pixel-red)', textShadow: '2px 2px 0 var(--pixel-gold)' }}>
        SETTINGS
      </h1>

      {/* Profile Card */}
      <div className="pixel-card space-y-2">
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '8px', color: 'var(--pixel-gold)', marginBottom: '8px' }}>
          MY PROFILE
        </div>
        <div style={{ fontFamily: "'VT323'", fontSize: '15px' }}>
          <div style={{ color: 'var(--pixel-gray)' }}>
            WALLET: <span style={{ color: '#e2e8f0', fontFamily: 'Courier New, monospace', fontSize: '12px' }}>
              {addr ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : '—'}
            </span>
          </div>
          <div style={{ color: 'var(--pixel-teal)' }}>CHAIN: ARBITRUM SEPOLIA</div>
          <div style={{ color: 'var(--pixel-gold)' }}>TRUST: LVL 1 BASIC</div>
        </div>
      </div>

      {/* Context Preferences */}
      <div className="pixel-card space-y-3">
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '8px', color: 'var(--pixel-gold)', marginBottom: '4px' }}>
          CONTEXT PREFERENCES
        </div>
        <div style={{ fontFamily: "'VT323'", fontSize: '14px', color: 'var(--pixel-gray)' }}>
          Update your encrypted context profile on-chain.
        </div>
        <Link href="/onboard" className="pixel-btn pixel-btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
          UPDATE CONTEXT
        </Link>
      </div>

      {/* Permit Manager — anchor target for Permits tab */}
      <div id="permits" className="space-y-2">
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '8px', color: 'var(--pixel-gold)' }}>
          AGENT PERMITS
        </div>
        <PermitManager permitState={permitState} authorize={authorize} revoke={revoke} loading={permitLoading} error={permitError} />
      </div>

      {/* Danger Zone */}
      <div className="pixel-card-danger space-y-3">
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '8px', color: 'var(--pixel-danger)' }}>
          DANGER ZONE
        </div>
        <div className="flex flex-col gap-2">
          <Link href="/onboard" className="pixel-btn pixel-btn-danger" style={{ textDecoration: 'none', textAlign: 'center' }}>
            🗑 RESET CONTEXT
          </Link>
          <button className="pixel-btn pixel-btn-ghost" onClick={logout}>
            🔌 DISCONNECT WALLET
          </button>
        </div>
      </div>

      <BottomNav />
    </main>
  );
}
