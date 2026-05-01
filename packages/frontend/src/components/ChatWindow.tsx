'use client';
import { useState, useRef, useEffect } from 'react';
import { useChat } from '@/hooks/useChat';
import type { PermitState } from '@/types/context';

interface Props {
  userAddress: `0x${string}`;
  permitState: PermitState;
}

export function ChatWindow({ userAddress, permitState }: Props) {
  const { messages, sendMessage, loading, error, needsTopUp } = useChat(userAddress, permitState.serializedPermit);
  const [input, setInput] = useState('');
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const visibleError = error && error !== dismissedError ? error : null;

  useEffect(() => {
    if (error !== dismissedError) setDismissedError(null);
  }, [error]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, visibleError]);

  if (!permitState.serializedPermit) {
    return (
      <div className="flex items-center justify-center h-full px-4">
        <div style={{ fontFamily: "'VT323'", fontSize: '16px', color: 'var(--pixel-gray)', textAlign: 'center' }}>
          AI AGENT NOT AUTHORIZED.<br />USE THE AUTHORIZE BUTTON ABOVE TO START CHATTING.
        </div>
      </div>
    );
  }

  async function handleSend() {
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setInput('');
    await sendMessage(msg);
  }

  return (
    <div className="flex flex-col h-full pixel-card p-0" style={{ borderColor: '#60a5fa', boxShadow: '0 0 10px rgba(96, 165, 250, 0.4)', borderRadius: '12px', background: 'var(--pixel-dark)', overflow: 'hidden' }}>
      
      {/* Top Banner indicating Agent/Context Status */}
      <div className="flex items-center justify-center gap-8 py-3" style={{ borderBottom: '1px solid rgba(96,165,250,0.3)', background: 'rgba(0,0,0,0.2)' }}>
        <span style={{ fontFamily: "'VT323'", fontSize: '16px', color: 'var(--pixel-green)', textShadow: '0 0 5px var(--pixel-green)' }}>
          🤖 AGENT READY
        </span>
        <span style={{ fontFamily: "'VT323'", fontSize: '16px', color: 'var(--pixel-red)', textShadow: '0 0 5px var(--pixel-red)' }}>
          🔒 CONTEXT ACTIVE
        </span>
      </div>

      {visibleError && (
        <div className="p-3 bg-red-900 text-red-200 text-sm flex justify-between">
            <span>⚠ {visibleError}</span>
            <button onClick={() => setDismissedError(visibleError)}>×</button>
        </div>
      )}

      {needsTopUp && (
        <div className="p-3" style={{ background: 'rgba(255,165,0,0.15)', borderBottom: '1px solid var(--pixel-gold)' }}>
          <div style={{ fontFamily: "'VT323'", fontSize: '16px', color: 'var(--pixel-gold)' }}>
            💰 INSUFFICIENT BALANCE — <a href="/payments" style={{ color: 'var(--pixel-red)', textDecoration: 'underline' }}>TOP UP YOUR AGENT BILLING</a> to continue chatting.
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {messages.map((m, idx) => {
          const isAI = m.role === 'assistant';
          const bubbleColor = isAI ? 'var(--pixel-green)' : 'var(--pixel-red)';
          return (
            <div key={idx} className={`flex ${isAI ? 'justify-start' : 'justify-end'}`}>
              <div
                className="pixel-card max-w-[80%]"
                style={{
                  border: `1px solid ${bubbleColor}`,
                  boxShadow: `0 0 10px ${isAI ? 'rgba(0,255,0,0.3)' : 'rgba(255,0,255,0.3)'}, inset 0 0 5px ${isAI ? 'rgba(0,255,0,0.1)' : 'rgba(255,0,255,0.1)'}`,
                  background: 'var(--pixel-black)',
                  padding: '12px 16px',
                  borderRadius: '12px',
                }}
              >
                <div style={{ fontFamily: "'Press Start 2P'", fontSize: '8px', color: bubbleColor, marginBottom: '8px' }}>
                  {isAI ? 'FHE AI' : 'USER'}
                </div>
                <div style={{ fontFamily: "'VT323'", fontSize: '16px', color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>
                  {m.content}
                </div>
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="flex justify-start">
            <div className="pixel-card" style={{ border: '1px solid var(--pixel-gray)', padding: '12px 16px', background: 'var(--pixel-black)', borderRadius: '12px' }}>
              <span className="pixel-cursor" style={{ fontFamily: "'Press Start 2P'", fontSize: '12px', color: 'var(--pixel-green)' }}>
                ...
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="p-4" style={{ background: 'rgba(0,0,0,0.3)' }}>
        <div className="flex items-stretch gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="> TYPE A MESSAGE..."
            className="flex-1"
            style={{
              background: 'var(--pixel-black)',
              border: '2px solid var(--pixel-danger)',
              boxShadow: '0 0 10px rgba(255,0,0,0.5), inset 0 0 5px rgba(255,0,0,0.2)',
              borderRadius: '8px',
              fontFamily: "'VT323'",
              fontSize: '18px',
              color: 'var(--pixel-danger)',
              padding: '0 16px',
              outline: 'none',
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="pixel-btn"
            style={{
              background: 'var(--pixel-red)',
              color: '#fff',
              border: '1px solid var(--pixel-red)',
              boxShadow: '0 0 10px rgba(255,0,255,0.6)',
              fontSize: '18px',
              padding: '0 24px',
              height: '48px',
              borderRadius: '8px',
            }}
          >
            SEND
          </button>
        </div>
      </div>
    </div>
  );
}
