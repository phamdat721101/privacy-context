'use client';
import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { useReadContract } from 'wagmi';
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
  const [drawerOpen, setDrawerOpen] = useState(false);

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
    <div className="page-container flex flex-col pb-16" style={{ height: '100dvh', background: 'var(--pixel-black)' }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: '2px solid var(--pixel-red)', background: 'var(--pixel-dark)' }}
      >
        <span style={{ fontFamily: "'Press Start 2P'", fontSize: '9px', color: 'var(--pixel-red)' }}>
          CHAT
        </span>
        <button
          onClick={() => setDrawerOpen(true)}
          style={{ fontFamily: "'VT323'", fontSize: '11px', color: 'var(--pixel-purple)', background: 'none', border: 'none', cursor: 'pointer' }}
          className="pixel-badge"
        >
          🔒 CONTEXT ACTIVE
        </button>
      </header>

      {/* Agent status banner */}
      <div
        className="px-4 py-2 shrink-0"
        style={{ background: 'var(--pixel-dark)', borderBottom: '1px solid #1e3a5f' }}
      >
        <span style={{ fontFamily: "'VT323'", fontSize: '14px', color: permitState.serializedPermit ? 'var(--pixel-green)' : 'var(--pixel-gray)' }}>
          🤖 {permitState.serializedPermit ? 'AGENT READY' : 'AGENT NOT AUTHORIZED'}
        </span>
      </div>

      {/* Permit prompt — only when no permit */}
      {!permitState.serializedPermit && (
        <div className="px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--pixel-red)' }}>
          <PermitManager permitState={permitState} authorize={authorize} revoke={revoke} loading={permitLoading} error={permitError} />
        </div>
      )}

      {/* Chat area */}
      <div className="flex-1 overflow-hidden">
        {userAddress
          ? <ChatWindow userAddress={userAddress} permitState={permitState} />
          : (
            <div className="flex items-center justify-center h-full">
              <span style={{ fontFamily: "'VT323'", fontSize: '15px', color: 'var(--pixel-gray)' }}>
                CONNECTING WALLET<span className="pixel-cursor">_</span>
              </span>
            </div>
          )
        }
      </div>

      <BottomNav />

      {/* Privacy drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => setDrawerOpen(false)}
        >
          <div
            className="px-4 py-6 space-y-4"
            style={{ background: 'var(--pixel-dark)', borderTop: '2px solid var(--pixel-red)', maxHeight: '80vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontFamily: "'Press Start 2P'", fontSize: '8px', color: 'var(--pixel-gold)' }}>
              🔐 PRIVACY CONTROLS
            </div>
            <PermitManager permitState={permitState} authorize={authorize} revoke={revoke} loading={permitLoading} error={permitError} />
            <button
              onClick={() => setDrawerOpen(false)}
              className="pixel-btn pixel-btn-ghost w-full"
              style={{ textAlign: 'center' }}
            >
              CLOSE
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
