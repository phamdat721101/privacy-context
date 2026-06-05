'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AgentCard } from '@/components/AgentCard';
import { MarketplaceCard, type MarketplaceCardType } from '@/components/MarketplaceCard';
import { MemWalBrainCard, type MemWalBrainSummary } from '@/components/MemWalBrainCard';
import { SwitchToSuiPrompt } from '@/components/RequireSuiNetwork';
import { listAgents, type Agent } from '@/lib/agents';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import { createLogger } from '@/lib/clientLogger';
import { useNetwork } from '@/hooks/useNetwork';
import { isSuiNetwork } from '@/lib/networks';

const log = createLogger('marketplace');

interface SuiProduct {
  id: string;
  workflow_key?: string;
  skill_key?: string;
  trace_key?: string;
  name: string;
  description?: string;
  default_price_usdc?: string;
  default_license_price_usdc?: string;
  steps?: unknown[];
  runs?: number;
  invocations?: number;
  licenses_sold?: number;
  sui_object_id?: string;
}

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
  const [activeType, setActiveType] = useState<'all' | MarketplaceCardType | 'memwal'>('all');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workflows, setWorkflows] = useState<SuiProduct[]>([]);
  const [skills, setSkills] = useState<SuiProduct[]>([]);
  const [reflective, setReflective] = useState<SuiProduct[]>([]);
  const [memwalBrains, setMemwalBrains] = useState<MemWalBrainSummary[]>([]);
  const { network } = useNetwork();
  const onSui = isSuiNetwork(network);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Discovery concierge state.
  const [discoverMsg, setDiscoverMsg] = useState('');
  const [discoverBusy, setDiscoverBusy] = useState(false);
  const [discoverResult, setDiscoverResult] = useState<DiscoverResult | null>(null);
  const [discoverErr, setDiscoverErr] = useState<string | null>(null);

  // Read ?type= from the URL once on mount (client-only; no SSR involvement).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = new URLSearchParams(window.location.search).get('type') as MarketplaceCardType | 'memwal' | null;
    if (t && ['brain', 'skill', 'workflow', 'reflective', 'memwal'].includes(t)) setActiveType(t);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      listAgents().catch(() => []),
      // Sui-native product types — fetch in parallel; tolerate 404 / older API.
      fetch(`${AGENT_BACKEND_URL}/v3/workflows?published=true`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch(`${AGENT_BACKEND_URL}/v3/skills?published=true`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch(`${AGENT_BACKEND_URL}/v3/reflective`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
    ])
      .then(([a, wf, sk, ref]) => {
        setAgents(a);
        setWorkflows(wf as SuiProduct[]);
        setSkills(sk as SuiProduct[]);
        setReflective(ref as SuiProduct[]);
      })
      .finally(() => setLoading(false));
  }, []);

  // Fetch MemWal-tier brains independently — always-public catalog endpoint,
  // safe to call regardless of network. We render the result only when the
  // user is on Sui (G1).
  useEffect(() => {
    fetch(`${AGENT_BACKEND_URL}/v3/memory/marketplace`)
      .then((r) => (r.ok ? r.json() : { brains: [] }))
      .then((j) => setMemwalBrains((j.brains ?? []) as MemWalBrainSummary[]))
      .catch(() => setMemwalBrains([]));
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

      {/* Type filter — tri-marketplace product types (G1: Sui-only types still listed
          for discovery; click triggers SwitchToSuiPrompt when on Standard tier).
          'memwal' is the new MemWal-tier filter (PRD-08); only meaningful on Sui. */}
      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'brain', 'skill', 'workflow', 'reflective', 'memwal'] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setActiveType(t);
              const params = new URLSearchParams(window.location.search);
              if (t === 'all') params.delete('type'); else params.set('type', t);
              router.replace(`/marketplace${params.toString() ? '?' + params.toString() : ''}`);
            }}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              activeType === t
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-outline-variant/40 text-on-surface-variant hover:border-primary/40'
            }`}
          >
            {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1) + 's'}
          </button>
        ))}
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
            All tags
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
        <div className="py-20 text-center text-on-surface-variant">Loading marketplace…</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(activeType === 'all' || activeType === 'brain') &&
            filtered.map((a) => (
              <MarketplaceCard
                key={`brain-${a.id}`}
                type="brain"
                id={a.id}
                title={a.title}
                description={a.description}
                priceUsdc={a.price?.amount ?? '0.05'}
                meta={{ tags: a.tags }}
              />
            ))}
          {(activeType === 'all' || activeType === 'workflow') &&
            workflows.map((w) => (
              <MarketplaceCard
                key={`wf-${w.id}`}
                type="workflow"
                id={w.id}
                title={w.name}
                description={w.description}
                priceUsdc={w.default_price_usdc ?? '0'}
                meta={{
                  stepCount: Array.isArray(w.steps) ? w.steps.length : 7,
                  runs: w.runs ?? 0,
                  suiObjectId: w.sui_object_id,
                }}
              />
            ))}
          {(activeType === 'all' || activeType === 'skill') &&
            skills.map((s) => (
              <MarketplaceCard
                key={`sk-${s.id}`}
                type="skill"
                id={s.id}
                title={s.name}
                description={s.description}
                priceUsdc={s.default_price_usdc ?? '0'}
                meta={{ suiObjectId: s.sui_object_id }}
              />
            ))}
          {(activeType === 'all' || activeType === 'reflective') &&
            reflective.map((r) => (
              <MarketplaceCard
                key={`ref-${r.id}`}
                type="reflective"
                id={r.id}
                title={r.name ?? `Reflective trace ${r.trace_key}`}
                description={r.description ?? 'Agent metacognition license'}
                priceUsdc={r.default_license_price_usdc ?? '5.00'}
                meta={{ licensesSold: r.licenses_sold ?? 0, suiObjectId: r.sui_object_id }}
              />
            ))}
          {/* MemWal-tier brains (PRD-08). Cards are rendered for everyone but
              clicking through paid query enforces Sui via requireSuiWallet. */}
          {(activeType === 'all' || activeType === 'memwal') &&
            memwalBrains.map((b) => <MemWalBrainCard key={`mw-${b.sui_object_id}`} brain={b} />)}
        </div>
      )}

      {/* Empty state when MemWal tab is active but user isn't on Sui — the
          server still returns brains, but paid query would fail closed. */}
      {activeType === 'memwal' && !onSui && (
        <div className="mt-6">
          <SwitchToSuiPrompt />
        </div>
      )}
      {activeType === 'memwal' && onSui && memwalBrains.length === 0 && !loading && (
        <p className="py-8 text-center text-sm text-on-surface-variant">
          No MemWal-tier brains published yet. Publish from{' '}
          <a href="/train" className="text-primary hover:underline">/train</a>.
        </p>
      )}
    </div>
  );
}
