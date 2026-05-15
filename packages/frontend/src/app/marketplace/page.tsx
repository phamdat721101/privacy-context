'use client';
import { useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BottomNav } from '@/components/BottomNav';
import { AGENT_BACKEND_URL } from '@/lib/contracts';

interface Brain { id: number; owner_address: string; title: string; description: string; tags: string[]; created_at: string; }

export default function BrainCatalogPage() {
  const { authenticated, ready } = usePrivy();
  const router = useRouter();
  const [brains, setBrains] = useState<Brain[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (ready && !authenticated) router.push('/'); }, [ready, authenticated, router]);
  useEffect(() => { fetchBrains(); }, []);

  async function fetchBrains() {
    setLoading(true);
    try {
      const url = search ? `${AGENT_BACKEND_URL}/brains/search?q=${encodeURIComponent(search)}` : `${AGENT_BACKEND_URL}/brains`;
      const res = await fetch(url);
      if (res.ok) setBrains(await res.json());
    } catch {} finally { setLoading(false); }
  }

  if (!ready || !authenticated) return null;

  return (
    <main className="bg-background text-text-primary min-h-screen pb-[120px]">
      <header className="bg-surface-container/80 backdrop-blur-lg border-b border-outline-variant/20 flex items-center px-4 md:px-8 h-[72px] sticky top-0 z-50">
        <Link href="/" className="text-on-surface-variant hover:text-primary p-2 rounded-full"><span className="material-symbols-outlined">arrow_back</span></Link>
        <span className="font-headline text-2xl font-bold text-on-surface ml-4">Brain Catalog</span>
      </header>

      <div className="max-w-6xl mx-auto px-4 md:px-8 pt-8">
        {/* Search */}
        <div className="flex gap-3 mb-8">
          <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && fetchBrains()}
            placeholder="Search brains..."
            className="flex-1 bg-surface border border-outline-variant/50 rounded-full py-3 px-5 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-text-muted" />
          <button onClick={fetchBrains} className="px-6 py-3 bg-primary text-on-primary rounded-full font-semibold hover:bg-primary/80 transition-colors">Search</button>
        </div>

        {loading ? (
          <div className="text-center text-text-muted py-20">Loading...</div>
        ) : brains.length === 0 ? (
          <div className="text-center py-20">
            <span className="material-symbols-outlined text-5xl text-text-muted mb-4 block">psychology</span>
            <p className="text-on-surface-variant text-lg">No published brains yet.</p>
            <p className="text-text-muted text-sm mt-1">Be the first to publish your knowledge!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {brains.map(brain => (
              <div key={brain.id} className="bg-card border border-outline-variant/20 rounded-xl p-5 hover:shadow-lg hover:-translate-y-0.5 transition-all">
                <div className="flex items-center gap-2 mb-3">
                  <span className="material-symbols-outlined text-primary">psychology</span>
                  <h3 className="font-headline font-semibold text-text-primary">{brain.title || `Brain #${brain.id}`}</h3>
                </div>
                <p className="text-on-surface-variant text-sm mb-3 line-clamp-2">{brain.description || 'Encrypted knowledge brain'}</p>
                <div className="flex gap-2 flex-wrap mb-4">
                  {brain.tags?.map(tag => (
                    <span key={tag} className="text-[12px] font-mono text-primary border border-primary/30 px-2 py-0.5 rounded-full">{tag}</span>
                  ))}
                </div>
                <Link href={`/chat?brainId=${brain.id}`}
                  className="inline-flex items-center gap-1 text-sm text-primary font-medium hover:underline">
                  Chat with brain <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
      <BottomNav />
    </main>
  );
}
