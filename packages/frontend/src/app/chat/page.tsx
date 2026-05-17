'use client';
import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { useChat } from '@/hooks/useChat';
import { usePermit } from '@/hooks/usePermit';
import { PermitManager } from '@/components/PermitManager';
import { BottomNav } from '@/components/BottomNav';
import Link from 'next/link';

export default function ChatPage() {
  const { authenticated, user, ready } = usePrivy();
  const router = useRouter();
  const userAddress = user?.wallet?.address as `0x${string}` | undefined;
  const [mode, setMode] = useState<'learn' | 'store'>('learn');
  const [input, setInput] = useState('');
  const { permitState, reason, authorize, revoke, forceUnauthorized, loading: permitLoading, error: permitError } = usePermit(userAddress);
  const { messages, sendMessage, loading, error, needsSubscription } = useChat(userAddress, forceUnauthorized);
  const isPermitted = !!permitState.serializedPermit;

  useEffect(() => { if (ready && !authenticated) router.push('/'); }, [ready, authenticated, router]);
  if (!ready || !authenticated || !userAddress) return null;

  async function handleSend() {
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setInput('');
    await sendMessage(msg, undefined, mode);
  }

  return (
    <div className="bg-background min-h-screen flex flex-col items-center">
      <div className="w-full max-w-[768px] flex flex-col min-h-screen relative">
        {/* Header */}
        <header className="flex justify-between items-center px-4 md:px-8 h-[72px] sticky top-0 z-50 bg-surface-container/80 backdrop-blur-lg border-b border-outline-variant/20">
          <Link href="/" className="text-on-surface-variant hover:text-primary p-2 rounded-full hover:bg-surface-bright/10">
            <span className="material-symbols-outlined">arrow_back</span>
          </Link>
          <span className="font-headline text-2xl font-bold text-on-surface tracking-tight">SECOND BRAIN</span>
          <div className="flex bg-surface-container-high rounded-full p-1 border border-outline-variant/30">
            <button onClick={() => setMode('learn')} className={`px-3 py-1 rounded-full font-mono text-[13px] transition-all ${mode === 'learn' ? 'bg-primary-container text-on-primary-container shadow-sm' : 'text-on-surface-variant hover:text-primary'}`}>LEARN</button>
            <button onClick={() => setMode('store')} className={`px-3 py-1 rounded-full font-mono text-[13px] transition-all ${mode === 'store' ? 'bg-secondary-container text-on-secondary shadow-sm' : 'text-on-surface-variant hover:text-primary'}`}>STORE</button>
          </div>
        </header>

        {/* Messages */}
        <main className="flex-1 overflow-y-auto px-4 md:px-8 py-8 flex flex-col gap-6 pb-[140px]">
          {!isPermitted ? (
            <div className="rounded-xl border border-tertiary/40 bg-tertiary/5 p-5 space-y-4">
              <div>
                <h2 className="font-headline text-xl font-bold mb-1">Authorize before chatting</h2>
                <p className="text-on-surface-variant text-sm">
                  Chat requires an FHE permit. The platform decrypts your brain only with
                  this permit; revoking it cuts access cryptographically.
                </p>
              </div>
              <PermitManager
                permitState={permitState}
                authorize={authorize}
                revoke={revoke}
                loading={permitLoading}
                error={permitError}
                reason={reason}
              />
            </div>
          ) : (
            <>
              {needsSubscription && (
                <div className="bg-tertiary-container/10 border border-tertiary/30 rounded-xl p-4 text-center">
                  <span className="text-tertiary text-sm">Subscription required. </span>
                  <Link href="/payments" className="text-primary underline text-sm">Subscribe now →</Link>
                </div>
              )}
              {error && !needsSubscription && (
                <div className="bg-error-container/20 border border-error/30 rounded-xl p-3 text-error text-sm">{error}</div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={m.role === 'user' ? 'chat-user' : (m.content.includes('stored') ? 'chat-store' : 'chat-ai')}>
                    {m.role === 'assistant' && (
                      <div className="flex items-center gap-2 mb-2">
                        <span className="material-symbols-outlined text-primary text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
                          {m.content.includes('stored') ? 'memory' : 'psychology'}
                        </span>
                        <span className="font-mono text-[13px] text-primary font-bold">
                          {m.content.includes('stored') ? 'Stored' : 'FHE Second Brain'}
                        </span>
                      </div>
                    )}
                    <p className="text-on-surface-variant">{m.content}</p>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="chat-ai"><span className="text-primary animate-pulse">Thinking...</span></div>
                </div>
              )}
            </>
          )}
        </main>

        {/* Input */}
        {isPermitted && (
        <div className="fixed bottom-0 w-full max-w-[768px] left-1/2 -translate-x-1/2 bg-surface-container-highest/90 backdrop-blur-xl border-t border-outline-variant/30 p-4 pb-8 z-50">
          <div className="relative flex items-center">
            <input
              value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="Ask your Second Brain..."
              className="w-full bg-surface text-on-surface border border-outline-variant/50 rounded-full py-3 pl-5 pr-12 focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-text-muted"
            />
            <button onClick={handleSend} disabled={!input.trim() || loading}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-primary text-on-primary rounded-full hover:bg-primary/80 transition-colors shadow-md disabled:opacity-50">
              <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
            </button>
          </div>
          <div className="text-center mt-2">
            <span className="text-[11px] font-mono text-text-muted flex items-center justify-center gap-1">
              <span className="material-symbols-outlined text-[12px]">lock</span>
              End-to-End Encrypted via FHE
            </span>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
