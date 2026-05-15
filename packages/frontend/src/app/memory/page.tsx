'use client';
import { useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BottomNav } from '@/components/BottomNav';
import { AGENT_BACKEND_URL } from '@/lib/contracts';

interface Brain { id: number; title: string; description: string; tags: string[]; published: boolean; created_at: string; }

export default function MyBrainPage() {
  const { authenticated, user, ready } = usePrivy();
  const router = useRouter();
  const userAddress = user?.wallet?.address;
  const [brains, setBrains] = useState<Brain[]>([]);
  const [selectedBrain, setSelectedBrain] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { if (ready && !authenticated) router.push('/'); }, [ready, authenticated, router]);
  useEffect(() => { if (userAddress) fetchMyBrains(); }, [userAddress]);

  async function fetchMyBrains() {
    try {
      const res = await fetch(`${AGENT_BACKEND_URL}/brains/mine`, { headers: { 'x-wallet-address': userAddress! } });
      if (res.ok) {
        const data = await res.json();
        setBrains(data);
        if (data.length > 0 && !selectedBrain) setSelectedBrain(data[0].id);
      }
    } catch {}
  }

  async function handleCreateBrain() {
    if (!userAddress) return;
    const title = prompt('Brain name:');
    if (!title) return;
    const res = await fetch(`${AGENT_BACKEND_URL}/brains/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-wallet-address': userAddress },
      body: JSON.stringify({ title }),
    });
    if (res.ok) { const brain = await res.json(); setMsg(`Created: ${brain.title}`); fetchMyBrains(); setSelectedBrain(brain.id); }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userAddress) return;
    setUploading(true); setMsg(null);
    try {
      const form = new FormData();
      form.append('file', file);
      if (selectedBrain) form.append('brainId', String(selectedBrain));
      const res = await fetch(`${AGENT_BACKEND_URL}/upload`, { method: 'POST', headers: { 'x-wallet-address': userAddress }, body: form });
      if (res.status === 402) { setMsg('Subscribe first to upload'); return; }
      if (!res.ok) throw new Error((await res.json()).error);
      const data = await res.json();
      setMsg(`Uploaded! Brain #${data.brainId} — ${data.estimatedChunks} chunks added`);
      fetchMyBrains();
    } catch (err: any) { setMsg(err.message); }
    finally { setUploading(false); e.target.value = ''; }
  }

  async function handlePublish(brainId: number) {
    if (!userAddress) return;
    const title = brains.find(b => b.id === brainId)?.title || `Brain #${brainId}`;
    const res = await fetch(`${AGENT_BACKEND_URL}/brains/publish`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-wallet-address': userAddress },
      body: JSON.stringify({ brainId, title, tags: ['knowledge'] }),
    });
    if (res.ok) { setMsg('Brain published to catalog!'); fetchMyBrains(); }
    else { const err = await res.json(); setMsg(err.error || 'Publish failed'); }
  }

  if (!ready || !authenticated) return null;

  return (
    <main className="bg-background text-text-primary min-h-screen pb-[120px]">
      <header className="bg-surface-container/80 backdrop-blur-lg border-b border-outline-variant/20 flex items-center px-4 md:px-8 h-[72px] sticky top-0 z-50">
        <Link href="/" className="text-on-surface-variant hover:text-primary p-2 rounded-full"><span className="material-symbols-outlined">arrow_back</span></Link>
        <span className="font-headline text-2xl font-bold text-on-surface ml-4">My Brain</span>
      </header>

      <div className="max-w-4xl mx-auto px-4 md:px-8 pt-8 space-y-8">
        {/* Upload Zone */}
        <div className="border-2 border-dashed border-outline-variant/50 rounded-xl p-8 text-center hover:border-secondary/50 transition-colors">
          <span className="material-symbols-outlined text-4xl text-text-muted mb-3 block">cloud_upload</span>

          {/* Brain Selector */}
          <div className="flex items-center justify-center gap-3 mb-4">
            <span className="text-on-surface-variant text-sm">Upload to:</span>
            <select
              value={selectedBrain || ''}
              onChange={e => setSelectedBrain(+e.target.value || null)}
              className="bg-surface border border-outline-variant/50 rounded-lg px-3 py-1.5 text-on-surface text-sm focus:ring-2 focus:ring-primary"
            >
              {brains.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
            <button onClick={handleCreateBrain} className="text-primary text-sm hover:underline">+ New Brain</button>
          </div>

          <p className="text-text-muted text-sm mb-4">.txt, .md, .csv — files append to selected brain</p>
          <label className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary rounded-full font-semibold cursor-pointer hover:bg-primary/80 transition-colors">
            <span className="material-symbols-outlined text-[18px]">upload_file</span>
            {uploading ? 'Uploading...' : 'Choose File'}
            <input type="file" accept=".txt,.md,.csv" onChange={handleUpload} className="hidden" disabled={uploading} />
          </label>
          <p className="text-text-muted text-xs mt-4 flex items-center justify-center gap-1">
            <span className="material-symbols-outlined text-[14px]">lock</span>
            Content is AES-encrypted. Key stored on-chain via FHE.
          </p>
        </div>

        {msg && (
          <div className={`rounded-xl p-3 text-sm text-center ${msg.includes('!') ? 'bg-secondary/10 border border-secondary/30 text-secondary' : 'bg-error-container/20 border border-error/30 text-error'}`}>
            {msg}
          </div>
        )}

        {/* Brain List */}
        <div>
          <h2 className="font-headline text-lg font-semibold mb-4">Your Brains ({brains.length})</h2>
          {brains.length === 0 ? (
            <div className="bg-card border border-outline-variant/20 rounded-xl p-8 text-center">
              <p className="text-on-surface-variant mb-4">No brains yet. Create one and upload files.</p>
              <button onClick={handleCreateBrain} className="px-5 py-2 bg-primary text-on-primary rounded-full font-semibold">Create First Brain</button>
            </div>
          ) : (
            <div className="space-y-3">
              {brains.map(brain => (
                <div key={brain.id} className="bg-card border border-outline-variant/20 rounded-xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-primary">psychology</span>
                    <div>
                      <span className="text-text-primary font-medium">{brain.title}</span>
                      <span className={`ml-3 text-xs font-mono ${brain.published ? 'text-secondary' : 'text-text-muted'}`}>
                        {brain.published ? '✓ Published' : '🔒 Private'}
                      </span>
                    </div>
                  </div>
                  {!brain.published && (
                    <button onClick={() => handlePublish(brain.id)}
                      className="px-4 py-1.5 bg-secondary/10 border border-secondary/30 text-secondary rounded-full text-sm font-medium hover:bg-secondary/20 transition-colors">
                      Publish
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <BottomNav />
    </main>
  );
}
