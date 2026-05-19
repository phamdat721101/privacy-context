'use client';
import { useState, useEffect } from 'react';
import { AGENT_BACKEND_URL } from '@/lib/contracts';

type Brain = { id: number; title: string; description: string; tags: string[]; owner_address: string; privacy_version: number };

export default function CatalogPage() {
  const [brains, setBrains] = useState<Brain[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${AGENT_BACKEND_URL}/v2/brains`).then(r => r.json()).then(setBrains).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const filtered = brains.filter(b =>
    !query || b.title.toLowerCase().includes(query.toLowerCase()) || b.tags?.some(t => t.includes(query.toLowerCase()))
  );

  return (
    <main className="flex flex-col min-h-screen bg-background text-on-surface">
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-surface/80 backdrop-blur px-4 py-3">
        <h1 className="font-bold text-lg">⌬ Brain Catalog</h1>
      </header>

      <div className="p-4 max-w-3xl mx-auto w-full space-y-4 pb-24">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search brains…"
          className="w-full h-10 rounded bg-surface-container border border-border px-3 text-on-surface text-sm" />

        {loading && <p className="text-text-muted text-sm">Loading…</p>}

        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map(b => (
            <a key={b.id} href={`/brain?tab=chat&brain=${b.id}`}
              className="rounded-lg border border-border bg-card p-4 hover:border-primary-container transition-colors">
              <div className="flex justify-between items-start">
                <h3 className="font-semibold text-sm">🧠 {b.title}</h3>
                {b.privacy_version === 2 && <span className="text-xs text-secondary">🔒 v2</span>}
              </div>
              <p className="text-xs text-on-surface-variant mt-1 line-clamp-2">{b.description}</p>
              <div className="flex gap-1 mt-2 flex-wrap">
                {b.tags?.map(t => <span key={t} className="text-xs bg-surface-container-high rounded-full px-2 py-0.5 text-text-muted">{t}</span>)}
              </div>
              <p className="text-xs text-primary mt-2">Chat with brain →</p>
            </a>
          ))}
        </div>

        {!loading && filtered.length === 0 && (
          <div className="text-center py-8">
            <p className="text-text-muted text-sm">No brains published yet.</p>
            <a href="/brain?tab=upload" className="text-primary text-sm mt-2 inline-block">Upload yours →</a>
          </div>
        )}
      </div>

      <nav className="fixed bottom-0 inset-x-0 flex border-t border-border bg-surface/90 backdrop-blur z-40">
        <a href="/brain" className="flex-1 py-3 text-center text-xs text-text-muted">🧠 Brain</a>
        <a href="/catalog" className="flex-1 py-3 text-center text-xs text-primary font-medium">⌬ Catalog</a>
        <a href="/settings" className="flex-1 py-3 text-center text-xs text-text-muted">⚙ Settings</a>
      </nav>
    </main>
  );
}
