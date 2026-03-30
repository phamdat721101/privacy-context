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
    <main className="page-container min-h-screen pb-28 px-8 py-8 space-y-6" style={{ background: 'var(--pixel-black)' }}>
      {/* Header */}
      <header className="flex items-center justify-between">
        <span style={{ fontFamily: "'Press Start 2P'", fontSize: '24px', color: 'var(--pixel-red)', textShadow: '0 0 10px var(--pixel-red)', letterSpacing: '0.1em' }}>
          FHE AI
        </span>
        <div className="flex items-center gap-3">
          <span className="pixel-badge" style={{ color: 'var(--pixel-teal)', borderColor: 'var(--pixel-teal)', padding: '6px 12px', fontSize: '12px' }}>
            NETWORK: ARBITRUM SEPOLIA
          </span>
          <WalletConnect />
        </div>
      </header>

      {/* Context Status Card */}
      <div className="pixel-card w-full" style={{ padding: '16px 20px' }}>
        <div style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: 'var(--pixel-red)', marginBottom: '16px' }}>
          CONTEXT STATUS
        </div>
        <div className="flex flex-row gap-8 items-center" style={{ fontFamily: "'VT323'", fontSize: '18px' }}>
          <span className="flex items-center gap-2" style={{ color: 'var(--pixel-red)' }}>
            <span style={{ fontSize: '14px' }}>🔒</span> FHE: ON
          </span>
          <span className="flex items-center gap-2" style={{ color: hasPermit ? 'var(--pixel-green)' : 'var(--pixel-gray)' }}>
            <span style={{ fontSize: '14px' }}>🤖</span> AGENT: {hasPermit ? 'AUTH' : 'NONE'}
          </span>
          <span className="flex items-center gap-2" style={{ color: hasPermit ? 'var(--pixel-teal)' : 'var(--pixel-gold)' }}>
            <span style={{ fontSize: '14px' }}>🧠</span> {hasPermit ? `EXP: ${expiresDate}` : 'NO PERMIT'}
          </span>
          <span className="flex items-center gap-2" style={{ color: contextActive ? 'var(--pixel-red)' : 'var(--pixel-gray)' }}>
            CTX: {contextActive ? 'ACTIVE' : 'NOT SET'}
          </span>
        </div>
      </div>

      {/* Action Tabs */}
      <div className="flex gap-2">
        <Link href="/chat" className="pixel-btn" style={{ background: 'var(--pixel-red)', color: '#fff', border: '1px solid var(--pixel-red)', boxShadow: '0 0 8px rgba(255,0,255,0.4)', textDecoration: 'none' }}>
          CHAT
        </Link>
        <Link href="/settings" className="pixel-btn pixel-btn-teal" style={{ textDecoration: 'none' }}>
          SETTINGS
        </Link>
      </div>

      {/* Main Content Area */}
      {!contextActive ? (
        <div className="pixel-card-gold flex flex-col items-center justify-center space-y-8" style={{ minHeight: '300px' }}>
          <div className="w-full text-left" style={{ fontFamily: "'VT323'", fontSize: '18px', color: 'var(--pixel-gold)' }}>
            SETUP REQUIRED
          </div>
          <div className="flex-1 flex items-center justify-center">
            <Link href="/onboard" className="pixel-btn pixel-btn-yellow" style={{ fontSize: '20px', padding: '12px 32px', textDecoration: 'none' }}>
              ACTIVATE PRIVATE AI
            </Link>
          </div>
        </div>
      ) : (
        <div className="pixel-card-teal flex flex-col space-y-4" style={{ minHeight: '300px' }}>
          <div className="w-full text-left" style={{ fontFamily: "'VT323'", fontSize: '18px', color: 'var(--pixel-teal)' }}>
            SYSTEM READY
          </div>
          <div className="flex-1 flex flex-col items-center justify-center space-y-4">
             <span style={{ fontFamily: "'Press Start 2P'", fontSize: '14px', color: 'var(--pixel-green)', textShadow: '0 0 5px var(--pixel-green)' }}>
                ENCRYPTED CONNECTION ESTABLISHED
             </span>
             <Link href="/chat" className="pixel-btn pixel-btn-primary" style={{ textDecoration: 'none', border: '1px solid var(--pixel-green)', color: 'var(--pixel-green)', boxShadow: '0 0 8px rgba(0,255,0,0.5)' }}>
               ENTER CHAT
             </Link>
          </div>
        </div>
      )}

      <BottomNav />
    </main>
  );
}
