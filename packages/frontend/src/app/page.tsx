'use client';
import { usePrivy } from '@privy-io/react-auth';
import Link from 'next/link';
import { useReadContract } from 'wagmi';
import { WalletConnect } from '@/components/WalletConnect';
import { BottomNav } from '@/components/BottomNav';
import { usePermit } from '@/hooks/usePermit';
import { ContextManagerAbi, CONTEXT_MANAGER_ADDRESS } from '@/lib/contracts';

export default function HomePage() {
  const { authenticated, ready, user } = usePrivy();
  const userAddress = user?.wallet?.address as `0x${string}` | undefined;
  const { permitState } = usePermit(userAddress);

  const { data: contextHandles } = useReadContract({
    abi: ContextManagerAbi,
    functionName: 'getContextHandles',
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: Boolean(userAddress) },
  });
  const contextActive = Boolean(contextHandles && (contextHandles as any).sessionKey !== 0n);

  if (!ready) {
    return (
      <main className="flex items-center justify-center min-h-screen">
        <span style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: 'var(--pixel-red)' }}>
          LOADING<span className="pixel-cursor">_</span>
        </span>
      </main>
    );
  }

  // Guest landing
  if (!authenticated) {
    return (
      <main className="flex flex-col items-center justify-center min-h-screen gap-8 px-4">
        <div className="text-center space-y-4">
          <h1 style={{ fontFamily: "'Press Start 2P'", fontSize: '14px', color: 'var(--pixel-red)', textShadow: '2px 2px 0 var(--pixel-gold)' }}>
            FHE CONTEXT<br />MANAGER
          </h1>
          <p style={{ fontFamily: "'VT323'", fontSize: '18px', color: 'var(--pixel-teal)', maxWidth: '360px' }}>
            YOUR AI. YOUR PRIVACY.<br />
            Context stored as encrypted ciphertext on Arbitrum — invisible without your permission.
          </p>
          <div className="flex gap-2 justify-center flex-wrap text-xs" style={{ fontFamily: "'VT323'", fontSize: '13px' }}>
            <span className="pixel-badge" style={{ color: 'var(--pixel-purple)' }}>FHENIX</span>
            <span className="pixel-badge" style={{ color: 'var(--pixel-teal)' }}>ARBITRUM</span>
            <span className="pixel-badge" style={{ color: 'var(--pixel-red)' }}>COFHE</span>
          </div>
        </div>
        <WalletConnect />
      </main>
    );
  }

  // Authenticated home dashboard
  const hasPermit = Boolean(permitState.serializedPermit);
  const expiresDate = permitState.expiresAt
    ? new Date(permitState.expiresAt * 1000).toLocaleDateString()
    : null;
  const addrShort = userAddress
    ? `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`
    : '—';

  return (
    <main className="page-container min-h-screen pb-20 px-4 py-4 space-y-4" style={{ background: 'var(--pixel-black)' }}>
      {/* Header */}
      <header className="flex items-center justify-between">
        <span style={{ fontFamily: "'Press Start 2P'", fontSize: '9px', color: 'var(--pixel-red)' }}>
          FHE AI
        </span>
        <div className="flex items-center gap-2">
          <span className="pixel-badge" style={{ color: 'var(--pixel-teal)', fontSize: '11px' }}>
            ARBITRUM
          </span>
          <WalletConnect />
        </div>
      </header>

      {/* Wallet info */}
      <div style={{ fontFamily: "'VT323'", fontSize: '13px', color: 'var(--pixel-gray)' }}>
        {addrShort}
      </div>

      {/* Context Status Card */}
      <div className="pixel-card space-y-2">
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '9px', color: 'var(--pixel-gold)', marginBottom: '8px' }}>
          CONTEXT STATUS
        </div>
        <div className="grid grid-cols-2 gap-2" style={{ fontFamily: "'VT323'", fontSize: '16px' }}>
          <span style={{ color: 'var(--pixel-purple)' }}>🔐 FHE: ON</span>
          <span style={{ color: hasPermit ? 'var(--pixel-green)' : 'var(--pixel-gray)' }}>
            🤖 AGENT: {hasPermit ? 'AUTH' : 'NONE'}
          </span>
          <span style={{ color: 'var(--pixel-teal)' }}>
            ⏱ {expiresDate ? `EXP: ${expiresDate}` : 'NO PERMIT'}
          </span>
          <span style={{ color: contextActive ? 'var(--pixel-gold)' : 'var(--pixel-gray)' }}>
            🧠 CTX: {contextActive ? 'ACTIVE' : 'NOT SET'}
          </span>
        </div>
      </div>

      {/* Context Status Bar */}
      <div className="space-y-1">
        <div className="flex justify-between" style={{ fontFamily: "'VT323'", fontSize: '14px', color: 'var(--pixel-gold)' }}>
          <span>CONTEXT</span>
          <span>{contextActive ? 'ACTIVE' : 'NOT SET'}</span>
        </div>
        <div className="pixel-progress">
          <div className="pixel-progress-fill" style={{ width: contextActive ? '100%' : '0%' }} />
        </div>
      </div>

      {/* Agent Access Bar */}
      <div className="space-y-1">
        <div className="flex justify-between" style={{ fontFamily: "'VT323'", fontSize: '14px', color: 'var(--pixel-teal)' }}>
          <span>AGENT ACCESS</span>
          <span>{hasPermit ? 'AUTHORIZED' : 'NOT SET'}</span>
        </div>
        <div className="pixel-progress pixel-progress-teal">
          <div className="pixel-progress-fill" style={{ width: hasPermit ? '100%' : '0%' }} />
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link href="/chat" className="pixel-btn pixel-btn-primary text-center" style={{ textDecoration: 'none' }}>
          💬 CHAT
        </Link>
        <Link href="/settings" className="pixel-btn pixel-btn-teal text-center" style={{ textDecoration: 'none' }}>
          ⚙ SETTINGS
        </Link>
      </div>

      {/* Last Activity */}
      <div className="pixel-card-gray">
        <div style={{ fontFamily: "'VT323'", fontSize: '14px', color: 'var(--pixel-gray)' }}>
          📡 LAST ACTIVITY
        </div>
        <div style={{ fontFamily: "'VT323'", fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
          No sessions yet
        </div>
      </div>

      {/* Setup prompt if no context */}
      {!contextActive && (
        <div className="pixel-card-gold text-center space-y-2">
          <div style={{ fontFamily: "'VT323'", fontSize: '15px', color: 'var(--pixel-gold)' }}>
            SETUP REQUIRED
          </div>
          <Link href="/onboard" className="pixel-btn pixel-btn-primary" style={{ textDecoration: 'none' }}>
            ACTIVATE PRIVATE AI
          </Link>
        </div>
      )}

      <BottomNav />
    </main>
  );
}
