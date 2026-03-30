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
    <main className="page-container min-h-screen pb-28 px-4 md:px-8 py-8 flex flex-col space-y-8" style={{ background: 'var(--pixel-black)' }}>
      {/* Header */}
      <header className="flex items-center justify-start mb-4">
        <Link href="/" style={{ textDecoration: 'none' }}>
          <span style={{ fontFamily: "'Press Start 2P'", fontSize: '24px', color: 'var(--pixel-red)', textShadow: '0 0 10px var(--pixel-red)', letterSpacing: '0.1em' }}>
            FHE AI
          </span>
        </Link>
        <span style={{ fontFamily: "'Press Start 2P'", fontSize: '18px', color: 'var(--pixel-gray)', margin: '0 16px' }}>/</span>
        <span style={{ fontFamily: "'Press Start 2P'", fontSize: '18px', color: '#fff' }}>SETTINGS</span>
      </header>

      {/* Main Settings Body */}
      <div className="flex flex-col gap-6 w-full mx-auto pb-10">
        
        {/* Profile Card */}
        <div className="pixel-card w-full flex flex-col md:flex-row justify-between items-start md:items-center p-6 gap-4">
          <div className="space-y-4">
            <div style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: 'var(--pixel-red)', textShadow: '0 0 5px var(--pixel-red)' }}>
              MY PROFILE
            </div>
            <div style={{ fontFamily: "'VT323'", fontSize: '18px', color: 'var(--pixel-gray)' }}>
              WALLET: <span style={{ color: '#fff', marginLeft: '12px' }}>{addr ? addr : '—'}</span>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="pixel-card-gray p-3 text-center" style={{ minWidth: '130px' }}>
              <div style={{ fontFamily: "'VT323'", fontSize: '16px', color: 'var(--pixel-teal)' }}>CHAIN</div>
              <div style={{ fontFamily: "'Press Start 2P'", fontSize: '8px', color: '#fff', marginTop: '6px' }}>ARB SEPOLIA</div>
            </div>
            <div className="pixel-card-gray p-3 text-center" style={{ minWidth: '130px' }}>
              <div style={{ fontFamily: "'VT323'", fontSize: '16px', color: 'var(--pixel-gold)' }}>TRUST</div>
              <div style={{ fontFamily: "'Press Start 2P'", fontSize: '8px', color: '#fff', marginTop: '6px' }}>LVL 1 BASIC</div>
            </div>
          </div>
        </div>

        {/* Permit Manager Wrapper */}
        <div className="w-full">
           <div style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: 'var(--pixel-gold)', textShadow: '0 0 5px var(--pixel-gold)', marginBottom: '16px' }}>
             AGENT PERMITS
           </div>
           <PermitManager permitState={permitState} authorize={authorize} revoke={revoke} loading={permitLoading} error={permitError} />
        </div>

        {/* Context Preferences */}
        <div className="pixel-card-gray w-full p-6 mt-2">
            <div style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: 'var(--pixel-gray)', marginBottom: '16px' }}>
                CONTEXT PREFERENCES
            </div>
            <div style={{ fontFamily: "'VT323'", fontSize: '16px', color: '#fff', marginBottom: '16px' }}>
                Update your underlying FHE contextual data profile.
            </div>
            <Link href="/onboard" className="pixel-btn pixel-btn-ghost">
                UPDATE CONTEXT
            </Link>
        </div>

        {/* Danger Zone */}
        <div className="pixel-card-danger p-6 w-full mt-4 space-y-6">
          <div style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: 'var(--pixel-danger)', textShadow: '0 0 5px var(--pixel-danger)' }}>
            DANGER ZONE
          </div>
          <div className="flex flex-col sm:flex-row gap-4">
            <Link href="/onboard" className="pixel-btn pixel-btn-danger flex-1" style={{ textAlign: 'center', padding: '16px' }}>
              RESET CONTEXT
            </Link>
            <button className="pixel-btn pixel-btn-blue flex-1" onClick={logout} style={{ textAlign: 'center', padding: '16px' }}>
              DISCONNECT WALLET
            </button>
          </div>
        </div>

      </div>

      <BottomNav />
    </main>
  );
}
