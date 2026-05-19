'use client';
import { useState, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useFheClient } from '@/hooks/useFheClient';
import { useUploadBrain } from '@/hooks/useUploadBrain';
import { useBrainChunks } from '@/hooks/useBrainChunks';
import { AGENT_BACKEND_URL } from '@/lib/contracts';

type Tab = 'chat' | 'upload' | 'manage';
type ChatMode = 'learn' | 'store';
type Msg = { role: 'user' | 'assistant'; content: string; verified?: boolean };

export default function BrainPage() {
  const { authenticated, user, login } = usePrivy();
  const { ready: fheReady } = useFheClient();
  const { upload, step: uploadStep } = useUploadBrain();
  const { decryptAndRank, loading: decrypting } = useBrainChunks();

  const [tab, setTab] = useState<Tab>('chat');
  const [mode, setMode] = useState<ChatMode>('learn');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [brainId, setBrainId] = useState<number | null>(null);
  const [sending, setSending] = useState(false);

  const addr = user?.wallet?.address;

  const sendMessage = useCallback(async () => {
    if (!input.trim() || !addr) return;
    const q = input.trim();
    setInput('');
    setMsgs(m => [...m, { role: 'user', content: q }]);
    setSending(true);

    try {
      if (mode === 'store') {
        await upload(q, brainId ?? undefined);
        setMsgs(m => [...m, { role: 'assistant', content: '✓ Stored and encrypted.' }]);
      } else {
        if (!brainId) { setMsgs(m => [...m, { role: 'assistant', content: 'Upload knowledge first.' }]); return; }
        const { topK } = await decryptAndRank(brainId, q, 5);
        const res = await fetch(`${AGENT_BACKEND_URL}/v2/inference`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-wallet-address': addr },
          body: JSON.stringify({ chunks: topK, question: q, brainId }),
        });
        const data = await res.json();
        setMsgs(m => [...m, { role: 'assistant', content: data.answer, verified: data.attestation?.verified }]);
      }
    } catch (e: any) {
      setMsgs(m => [...m, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally { setSending(false); }
  }, [input, addr, mode, brainId, upload, decryptAndRank]);

  if (!authenticated) return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-background text-on-surface gap-6 p-4">
      <h1 className="text-3xl font-bold">FHE Second Brain</h1>
      <p className="text-on-surface-variant text-center max-w-md">Your knowledge. Encrypted. Yours.</p>
      <button onClick={login} className="px-6 py-3 bg-primary-container text-on-primary-container rounded-lg font-semibold">Connect Wallet</button>
    </main>
  );

  return (
    <main className="flex flex-col min-h-screen bg-background text-on-surface">
      {/* Header */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-surface/80 backdrop-blur px-4 py-3">
        <h1 className="font-bold text-lg">🧠 FHE Second Brain</h1>
        <span className="font-mono text-xs text-text-muted">{addr?.slice(0,6)}…{addr?.slice(-4)}</span>
      </header>

      {/* Tabs */}
      <nav className="flex border-b border-border">
        {(['chat', 'upload', 'manage'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-medium capitalize ${tab === t ? 'text-primary border-b-2 border-primary' : 'text-text-muted'}`}>
            {t}
          </button>
        ))}
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 pb-24">
        {tab === 'chat' && <ChatTab msgs={msgs} input={input} setInput={setInput} send={sendMessage} mode={mode} setMode={setMode} sending={sending || decrypting} />}
        {tab === 'upload' && <UploadTab onUpload={async (text) => { const r = await upload(text); setBrainId(r.brainId); }} step={uploadStep} />}
        {tab === 'manage' && <ManageTab brainId={brainId} addr={addr} />}
      </div>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 inset-x-0 flex border-t border-border bg-surface/90 backdrop-blur z-40">
        <a href="/" className="flex-1 py-3 text-center text-xs text-primary font-medium">🧠 Brain</a>
        <a href="/catalog" className="flex-1 py-3 text-center text-xs text-text-muted">⌬ Catalog</a>
        <a href="/settings" className="flex-1 py-3 text-center text-xs text-text-muted">⚙ Settings</a>
      </nav>
    </main>
  );
}

// --- Sub-components (kept in same file for simplicity) ---

function ChatTab({ msgs, input, setInput, send, mode, setMode, sending }: any) {
  return (
    <div className="flex flex-col gap-3 max-w-2xl mx-auto">
      <div className="flex gap-2 mb-2">
        <button onClick={() => setMode('learn')} className={`px-3 py-1 rounded-full text-xs font-medium ${mode === 'learn' ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container text-text-muted'}`}>Learn</button>
        <button onClick={() => setMode('store')} className={`px-3 py-1 rounded-full text-xs font-medium ${mode === 'store' ? 'bg-secondary-container text-on-secondary' : 'bg-surface-container text-text-muted'}`}>Store</button>
      </div>
      <div className="flex-1 space-y-2 min-h-[200px]">
        {msgs.length === 0 && <p className="text-text-muted text-sm text-center pt-8">Start a conversation. Switch modes any time.</p>}
        {msgs.map((m: Msg, i: number) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg p-3 text-sm ${m.role === 'user' ? 'bg-surface-container-high' : 'bg-card border-l-4 border-l-primary'}`}>
              {m.content}
              {m.verified && <span className="ml-2 text-xs text-secondary">🛡️ TN verified</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 sticky bottom-16">
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
          placeholder={mode === 'learn' ? 'Ask your brain…' : 'Tell your brain…'}
          className="flex-1 h-10 rounded bg-surface-container border border-border px-3 text-on-surface text-sm" />
        <button onClick={send} disabled={sending} className="px-4 h-10 rounded bg-primary-container text-on-primary-container text-sm font-medium disabled:opacity-50">
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

function UploadTab({ onUpload, step }: { onUpload: (t: string) => Promise<void>; step: string }) {
  const [text, setText] = useState('');
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <p className="text-sm text-on-surface-variant">Paste or type content. Encrypted before it leaves your device.</p>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={6}
        className="w-full rounded bg-surface-container border border-border p-3 text-on-surface text-sm resize-y"
        placeholder="Paste knowledge here…" />
      <div className="flex items-center gap-3">
        <button onClick={() => { if (text.trim()) onUpload(text.trim()); }} disabled={!text.trim() || step !== 'idle' && step !== 'done' && step !== 'error'}
          className="px-4 py-2 rounded bg-secondary-container text-on-secondary text-sm font-medium disabled:opacity-50">
          {step === 'idle' || step === 'done' || step === 'error' ? 'Encrypt & Upload' : step}
        </button>
        {step !== 'idle' && <span className="text-xs text-text-muted">{step}</span>}
      </div>
    </div>
  );
}

function ManageTab({ brainId, addr }: { brainId: number | null; addr?: string }) {
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h2 className="text-lg font-semibold">My Brains</h2>
      {brainId ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex justify-between items-center">
            <span className="font-medium">Brain #{brainId}</span>
            <span className="text-xs text-secondary">🔒 v2 encrypted</span>
          </div>
          <p className="text-xs text-text-muted mt-1">Owner: {addr?.slice(0,10)}…</p>
        </div>
      ) : (
        <p className="text-sm text-text-muted">No brains yet. Upload knowledge to create one.</p>
      )}
    </div>
  );
}
