'use client';
import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { useReadContract } from 'wagmi';
import Link from 'next/link';
import { PermitManager } from '@/components/PermitManager';
import { ChatWindow } from '@/components/ChatWindow';
import { BottomNav } from '@/components/BottomNav';
import { usePermit } from '@/hooks/usePermit';
import { ContextManagerAbi, CONTEXT_MANAGER_ADDRESS } from '@/lib/contracts';

export default function ChatPage() {
  const { authenticated, user, ready } = usePrivy();
  const router = useRouter();
  const userAddress = user?.wallet?.address as `0x${string}` | undefined;
  const { permitState, authorize, revoke, loading: permitLoading, error: permitError } = usePermit(userAddress);

  const { data: contextHandles } = useReadContract({
    abi: ContextManagerAbi,
    functionName: 'getContextHandles',
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: Boolean(userAddress) },
  });
  const contextExists = Boolean(contextHandles && (contextHandles as any).sessionKey !== 0n);

  useEffect(() => {
    if (ready && !authenticated) router.push('/');
  }, [ready, authenticated, router]);

  useEffect(() => {
    if (ready && authenticated && userAddress && contextHandles !== undefined && !contextExists) {
      router.push('/onboard');
    }
  }, [ready, authenticated, userAddress, contextHandles, contextExists, router]);

  if (!ready || !authenticated) return null;

  return (
    <main className="page-container min-h-screen pb-28 px-4 md:px-8 py-8 flex flex-col" style={{ background: 'var(--pixel-black)' }}>
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link href="/" style={{ textDecoration: 'none' }}>
            <span style={{ fontFamily: "'Press Start 2P'", fontSize: '24px', color: 'var(--pixel-red)', textShadow: '0 0 10px var(--pixel-red)', letterSpacing: '0.1em' }}>
              FHE AI
            </span>
          </Link>
          <span style={{ fontFamily: "'Press Start 2P'", fontSize: '18px', color: 'var(--pixel-gray)' }}>/</span>
          <span style={{ fontFamily: "'Press Start 2P'", fontSize: '18px', color: '#fff' }}>CHAT</span>
        </div>
      </header>

      {/* Main Dual Pane Layout */}
      <div className="flex flex-col md:flex-row flex-1 gap-6 md:h-[calc(100vh-160px)]">
        
        {/* Left Sidebar: Session History */}
        <div className="w-full md:w-64 flex flex-col gap-4">
          <div className="pixel-card flex flex-col h-full space-y-4" style={{ padding: '16px' }}>
            <div style={{ fontFamily: "'Press Start 2P'", fontSize: '12px', color: 'var(--pixel-red)', textShadow: '0 0 5px var(--pixel-red)' }}>
              SESSION HISTORY
            </div>
            
            <button className="pixel-btn pixel-btn-primary w-full" style={{ padding: '12px' }}>
              + NEW CHAT
            </button>
            
            <div className="flex-1 overflow-y-auto space-y-2 mt-4">
               <div style={{ fontFamily: "'VT323'", fontSize: '14px', color: 'var(--pixel-gray)', marginBottom: '8px' }}>TODAY</div>
               <div className="pixel-card-gray cursor-pointer hover:bg-white/5 transition-colors" style={{ padding: '8px 12px', borderRadius: '4px' }}>
                 <span style={{ fontFamily: "'VT323'", fontSize: '16px', color: '#fff' }}>Analyze smart contract...</span>
               </div>
               <div className="pixel-card-gray cursor-pointer hover:bg-white/5 transition-colors" style={{ padding: '8px 12px', borderRadius: '4px' }}>
                 <span style={{ fontFamily: "'VT323'", fontSize: '16px', color: '#fff' }}>Explain FHE...</span>
               </div>
            </div>
          </div>
        </div>

        {/* Right Pane: Chat Window */}
        <div className="flex-1 flex flex-col">
          {!permitState.serializedPermit && (
            <div className="mb-4 pixel-card-gold p-4">
               <div style={{ fontFamily: "'VT323'", fontSize: '16px', color: 'var(--pixel-gold)', marginBottom: '8px' }}>
                 AGENT PERMIT REQUIRED
               </div>
               <PermitManager permitState={permitState} authorize={authorize} revoke={revoke} loading={permitLoading} error={permitError} />
            </div>
          )}

          <div className="flex-1 relative h-[600px] md:h-auto">
            {userAddress ? (
               <ChatWindow userAddress={userAddress} permitState={permitState} />
            ) : (
               <div className="flex items-center justify-center h-full pixel-card">
                 <span style={{ fontFamily: "'VT323'", fontSize: '18px', color: 'var(--pixel-gray)' }}>
                   CONNECTING WALLET<span className="pixel-cursor">_</span>
                 </span>
               </div>
            )}
          </div>
        </div>

      </div>

      <BottomNav />
    </main>
  );
}
