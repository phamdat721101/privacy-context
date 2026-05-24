'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AgentCard } from '@/components/AgentCard';
import { listAgents, type Agent } from '@/lib/agents';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import { createLogger } from '@/lib/clientLogger';

const log = createLogger('marketplace');

const HINT_KEY = 'fhedin:marketplace-cross-store-hint';

interface DiscoverBundle {
  id: string;
  aggregate_price_usdc: string;
  expires_at: number;
  steps: Array<{ rail: string; price_usdc: string; agent_id: string }>;
}
interface DiscoverResult {
  candidates: Array<{ agent_id: string; persona_summary: string; chain: string; score: number }>;
  bundle: DiscoverBundle | null;
}

export default function MarketplacePage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hintDismissed, setHintDismissed] = useState(true);
  useEffect(() => {
    try { setHintDismissed(window.localStorage.getItem(HINT_KEY) === '1'); } catch { /* ignore */ }
  }, []);

  // Discovery concierge state.
  const [discoverMsg, setDiscoverMsg] = useState('');
  const [discoverBusy, setDiscoverBusy] = useState(false);
  const [discoverResult, setDiscoverResult] = useState<DiscoverResult | null>(null);
  const [discoverErr, setDiscoverErr] = useState<string | null>(null);

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
      {!hintDismissed && (
        <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          <span className="material-symbols-outlined text-[18px] text-primary">info</span>
          <div className="flex-1">
            Looking for your <strong>on-chain memories</strong> instead of paid brains?
            They live at <Link href="/memory" className="underline hover:text-primary">/memory</Link>.
            Brains and memories are separate stores by design.
          </div>
          <button
            type="button"
            onClick={() => {
              try { window.localStorage.setItem(HINT_KEY, '1'); } catch { /* ignore */ }
              setHintDismissed(true);
            }}
            className="rounded p-1 text-on-surface-variant hover:bg-surface-container"
            aria-label="Dismiss"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}
      <div className="space-y-2">
        <h1 className="font-headline text-3xl font-bold">Marketplace</h1>
        <p className="text-on-surface-variant">
          Browse encrypted AI agents. Every answer is cryptographically verified.
        </p>
      </div>

      {/* Discovery concierge — describe what you need; get a signed bundle. */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
        <div className="mb-2 text-xs uppercase text-primary">Find an agent</div>
        <div className="flex gap-2">
          <input
            value={discoverMsg}
            onChange={(e) => setDiscoverMsg(e.target.value)}
            placeholder="I need to audit a Solidity FHE contract and write a one-pager."
            className="flex-1 rounded-lg border border-outline-variant/40 bg-surface px-3 py-2 text-on-surface focus:border-primary/60 focus:outline-none"
            onKeyDown={async (e) => {
              if (e.key !== 'Enter' || !discoverMsg.trim() || discoverBusy) return;
              setDiscoverBusy(true);
              setDiscoverErr(null);
              try {
                const r = await fetch(`${AGENT_BACKEND_URL}/v3/discover`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ message: discoverMsg }),
                });
                if (!r.ok) throw new Error(`${r.status}`);
                setDiscoverResult(await r.json());
                log.info('discover:ok', { len: discoverMsg.length });
              } catch (err: any) {
                log.warn('discover:failed', { err: err?.message });
                setDiscoverErr(`${err?.message ?? err} — API may be on an older build.`);
              } finally {
                setDiscoverBusy(false);
              }
            }}
          />
          <button
            disabled={discoverBusy || !discoverMsg.trim()}
            onClick={async () => {
              setDiscoverBusy(true);
              setDiscoverErr(null);
              try {
                const r = await fetch(`${AGENT_BACKEND_URL}/v3/discover`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ message: discoverMsg }),
                });
                if (!r.ok) throw new Error(`${r.status}`);
                setDiscoverResult(await r.json());
              } catch (err: any) {
                setDiscoverErr(`${err?.message ?? err} — API may be on an older build.`);
              } finally {
                setDiscoverBusy(false);
              }
            }}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50"
          >
            {discoverBusy ? '…' : 'Discover'}
          </button>
        </div>
        {discoverErr && <p className="mt-2 text-xs text-amber-500">{discoverErr}</p>}
        {discoverResult && discoverResult.bundle && (
          <div className="mt-3 flex items-center justify-between rounded-lg border border-primary/40 bg-surface px-3 py-2">
            <div>
              <div className="text-xs text-on-surface-variant">{discoverResult.candidates.length} candidates · bundle ready</div>
              <div className="font-mono text-[10px] text-on-surface-variant">{discoverResult.bundle.id}</div>
            </div>
            <button
              onClick={() => router.push(`/bundles/${encodeURIComponent(discoverResult.bundle!.id)}`)}
              className="rounded-full bg-primary px-3 py-1 text-xs text-on-primary"
            >
              ${Number(discoverResult.bundle.aggregate_price_usdc).toFixed(4)} → review
            </button>
          </div>
        )}
        {discoverResult && !discoverResult.bundle && (
          <p className="mt-2 text-xs text-on-surface-variant">No matches yet — try different phrasing or browse below.</p>
        )}
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
