'use client';
import { useEffect, useMemo, useState } from 'react';
import { AgentCard } from '@/components/AgentCard';
import { listAgents, type Agent } from '@/lib/agents';

export default function MarketplacePage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    listAgents()
      .then(setAgents)
      .finally(() => setLoading(false));
  }, []);

  // Top-10 most-frequent tags, used as filter chips.
  const tags = useMemo(() => {
    const seen = new Map<string, number>();
    agents.forEach((a) => a.tags.forEach((t) => seen.set(t, (seen.get(t) ?? 0) + 1)));
    return Array.from(seen.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag]) => tag);
  }, [agents]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return agents.filter((a) => {
      if (activeTag && !a.tags.includes(activeTag)) return false;
      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [agents, search, activeTag]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-headline text-3xl font-bold">Marketplace</h1>
        <p className="text-on-surface-variant">
          Browse encrypted AI agents. Every answer is cryptographically verified.
        </p>
      </div>

      <div className="relative">
        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
          search
        </span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agents, capabilities, tags..."
          className="w-full rounded-full border border-outline-variant/40 bg-surface py-3 pl-10 pr-4 text-on-surface placeholder:text-on-surface-variant focus:border-primary/60 focus:outline-none"
        />
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveTag(null)}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              activeTag === null
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-outline-variant/40 text-on-surface-variant hover:border-primary/40'
            }`}
          >
            All
          </button>
          {tags.map((t) => (
            <button
              key={t}
              onClick={() => setActiveTag(t === activeTag ? null : t)}
              className={`rounded-full border px-3 py-1.5 font-mono text-xs transition-colors ${
                activeTag === t
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-outline-variant/40 text-on-surface-variant hover:border-primary/40'
              }`}
            >
              #{t}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-on-surface-variant">Loading agents…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-12 text-center">
          <span className="material-symbols-outlined mb-3 text-4xl text-on-surface-variant">
            search_off
          </span>
          <p className="text-on-surface-variant">No agents match your search.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((a) => (
            <AgentCard key={a.id} {...a} />
          ))}
        </div>
      )}
    </div>
  );
}
