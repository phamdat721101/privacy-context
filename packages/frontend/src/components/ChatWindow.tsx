'use client';
import { useState, useRef, useEffect } from 'react';
import { useChat } from '@/hooks/useChat';
import type { PermitState } from '@/types/context';

interface Props {
  userAddress: `0x${string}`;
  permitState: PermitState;
}

export function ChatWindow({ userAddress, permitState }: Props) {
  const { messages, sendMessage, loading, error } = useChat(userAddress, permitState.serializedPermit);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, error]);

  if (!permitState.serializedPermit) {
    return (
      <div className="flex items-center justify-center h-full px-4">
        <div style={{ fontFamily: "'VT323'", fontSize: '16px', color: 'var(--pixel-gray)', textAlign: 'center' }}>
          AUTHORIZE THE AI AGENT FIRST<br />TO START CHATTING.
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
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 p-4">
        {messages.length === 0 && (
          <div style={{ fontFamily: "'VT323'", fontSize: '15px', color: 'var(--pixel-gray)', textAlign: 'center', paddingTop: '2rem' }}>
            WHAT CAN I HELP YOU WITH TODAY?
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              style={{
                maxWidth: 'min(72%, calc(100vw - 64px))',
                padding: '10px 14px',
                fontFamily: "'VT323'",
                fontSize: '16px',
                lineHeight: 1.4,
                border: '2px solid',
                borderRadius: 0,
                borderColor: msg.role === 'user' ? 'var(--pixel-gold)' : 'var(--pixel-teal)',
                background: msg.role === 'user' ? 'var(--pixel-red)' : 'var(--pixel-dark)',
                color: '#fff',
                boxShadow: msg.role === 'user'
                  ? '3px 3px 0 var(--pixel-gold)'
                  : '3px 3px 0 var(--pixel-teal)',
              }}
            >
              {msg.role === 'assistant' && (
                <span style={{ color: 'var(--pixel-teal)', marginRight: '6px' }}>🤖</span>
              )}
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div
              style={{
                padding: '10px 14px',
                fontFamily: "'VT323'",
                fontSize: '16px',
                border: '2px solid var(--pixel-teal)',
                background: 'var(--pixel-dark)',
                color: 'var(--pixel-teal)',
                boxShadow: '3px 3px 0 var(--pixel-teal)',
              }}
            >
              🤖 <span className="pixel-cursor">▌</span>
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-start">
            <div
              style={{
                padding: '10px 14px',
                fontFamily: "'VT323'",
                fontSize: '15px',
                border: '2px solid var(--pixel-danger)',
                background: 'var(--pixel-dark)',
                color: 'var(--pixel-danger)',
                boxShadow: '3px 3px 0 var(--pixel-danger)',
                maxWidth: '80%',
              }}
            >
              ⚠ ERROR: {error}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div
        className="flex gap-2 p-3 shrink-0"
        style={{ borderTop: '2px solid var(--pixel-red)', background: 'var(--pixel-dark)' }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="TYPE A MESSAGE..."
          style={{
            flex: 1,
            background: '#0d1117',
            color: '#e2e8f0',
            border: '2px solid var(--pixel-gray)',
            borderRadius: 0,
            padding: '8px 12px',
            fontFamily: "'VT323'",
            fontSize: '16px',
            outline: 'none',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--pixel-gold)'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--pixel-gray)'; }}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="pixel-btn pixel-btn-primary"
          style={{ padding: '8px 16px', fontSize: '14px' }}
        >
          SEND
        </button>
      </div>
    </div>
  );
}
