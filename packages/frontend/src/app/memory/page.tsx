'use client';

/**
 * /memory — live feed of agent memories on Arkiv-Braga.
 *
 * Why this page exists: showcases the moonshot narrative — agents accumulate
 * a queryable, tamper-proof public profile on Arkiv. Judges can verify any
 * card by clicking the explorer link (no Fhedin server in the trust path).
 *
 * Data flow:
 *   1. mount  → REST GET /v4/memory/by-agent/:id (initial 20)
 *   2. mount  → subscribeMemoryEvents (poll 2s) for live updates
 *   3. extend → POST /v4/memory/:key/extend (402 → x402 receipt → 200)
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  fetchMemoriesByAgent,
  fetchDecisionsByAgent,
  subscribeMemoryEvents,
  ARKIV_BLOCK_EXPLORER,
  ARKIV_DATA_EXPLORER,
  ARKIV_PROJECT_ATTRIBUTE,
  MEMORY_AGENT_WALLET,
  type MemoryCard,
  type DecisionRow,
} from '@/lib/arkiv';
import { AGENT_BACKEND_URL } from '@/lib/contracts';

const POLL_MS = 2000;

export default function MemoryPage() {
  const [cards, setCards] = useState<MemoryCard[]>([]);
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [tickN, setTickN] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agentId = MEMORY_AGENT_WALLET;

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    Promise.all([
      fetchMemoriesByAgent(agentId as `0x${string}`, 50),
      fetchDecisionsByAgent(agentId as `0x${string}`, 10),
    ])
      .then(([memories, decs]) => { if (!cancelled) { setCards(memories); setDecisions(decs); } })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [agentId]);

  // Live event subscription — refresh both lists on any create/extend/expire.
  useEffect(() => {
    if (!agentId) return;
    let unsub: (() => void) | null = null;
    subscribeMemoryEvents(
      {
        onCreated: () => void refreshSoon(setCards, setDecisions, agentId as `0x${string}`),
        onExtended: () => void refreshSoon(setCards, setDecisions, agentId as `0x${string}`),
        onExpired: () => void refreshSoon(setCards, setDecisions, agentId as `0x${string}`),
        onError: (err) => setError(err.message),
      },
      POLL_MS,
    ).then((u) => { unsub = u; }).catch((e) => setError((e as Error).message));
    return () => { if (unsub) unsub(); };
  }, [agentId]);

  // 1-second TTL countdown ticker.
  useEffect(() => {
    const t = setInterval(() => setTickN((n) => (n + 1) % 1_000_000), 1000);
    return () => clearInterval(t);
  }, []);

  const stats = useMemo(() => {
    const byTopic = new Map<string, number>();
    let plaintext = 0;
    let confidential = 0;
    for (const c of cards) {
      const topic = String(c.attributes.topic ?? 'unknown');
      byTopic.set(topic, (byTopic.get(topic) ?? 0) + 1);
      if (c.confidential) confidential += 1; else plaintext += 1;
    }
    return { topics: byTopic.size, plaintext, confidential, total: cards.length };
  }, [cards, tickN]);

  if (!agentId) {
    return (
      <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-8 text-center">
        <p className="text-on-surface-variant">
          NEXT_PUBLIC_MEMORY_AGENT_WALLET is unset. Run{' '}
          <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-sm">npm run gen:demo-wallets</code>{' '}
          to provision demo wallets.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface p-6">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary">memory</span>
          <h1 className="font-headline text-2xl font-bold">Memory-Agent profile</h1>
          <span className="rounded-full border border-secondary/30 bg-secondary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-secondary">
            arkiv · braga
          </span>
        </div>
        <p className="text-sm text-on-surface-variant">
          Every learned fact below is a public Arkiv entity tagged{' '}
          <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-xs">project={ARKIV_PROJECT_ATTRIBUTE}</code>.
          Read them yourself with a{' '}
          <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-xs">createPublicClient</code> —
          no Fhedin server in the trust path.
        </p>
        <dl className="grid grid-cols-3 gap-4 pt-2 text-xs">
          <Stat label="memories" value={stats.total} />
          <Stat label="topics" value={stats.topics} />
          <Stat label="confidential" value={stats.confidential} hint={`${stats.plaintext} plaintext`} />
        </dl>
        <div className="flex flex-wrap gap-2 pt-1">
          <a
            href={`${ARKIV_DATA_EXPLORER}?owner=${agentId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/40 px-3 py-1 font-mono text-[11px] hover:border-primary/40"
          >
            <span className="material-symbols-outlined text-[14px]">open_in_new</span>
            Verify on data.arkiv.network
          </a>
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/40 px-3 py-1 font-mono text-[11px] hover:border-primary/40"
          >
            <span className="material-symbols-outlined text-[14px]">storefront</span>
            Marketplace
          </Link>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-error/40 bg-error/10 p-3 font-mono text-xs text-error">
          {error}
        </div>
      )}

      {decisions.length > 0 && <DecisionsStrip rows={decisions} />}

      {cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-10 text-center">
          <p className="text-on-surface-variant">
            No memories yet. Boot the api with{' '}
            <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-sm">MEMORY_AGENT_ENABLED=true</code>{' '}
            and publish a brain — the first fact appears within seconds.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {cards.map((c) => (
            <MemoryCardRow key={c.entityKey} card={c} now={Date.now() + tickN * 0} onExtend={async () => {
              if (busy) return;
              setBusy(true);
              try {
                await extendOne(c.entityKey);
                const fresh = await fetchMemoriesByAgent(agentId as `0x${string}`, 50);
                setCards(fresh);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

let _refreshTimer: ReturnType<typeof setTimeout> | null = null;
function refreshSoon(
  setCards: (m: MemoryCard[]) => void,
  setDecisions: (d: DecisionRow[]) => void,
  agentId: `0x${string}`,
) {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(() => {
    fetchMemoriesByAgent(agentId, 50).then(setCards).catch(() => undefined);
    fetchDecisionsByAgent(agentId, 10).then(setDecisions).catch(() => undefined);
  }, 800);
}

async function extendOne(entityKey: string): Promise<void> {
  // First request → 402 with WWW-Authenticate: Payment.
  // For the demo we mock the receipt by reading the challenge id from the
  // header and posting a deterministic receipt back. Real x402 client lives
  // in @fhe-ai-context/sdk → payRouter. For the v1 hackathon UI we keep the
  // fetch local so the demo runs without a wallet popup on every click.
  const r1 = await fetch(`${AGENT_BACKEND_URL}/v4/memory/${entityKey}/extend`, { method: 'POST' });
  if (r1.status === 402) {
    const wwwAuth = r1.headers.get('WWW-Authenticate') ?? '';
    const idMatch = wwwAuth.match(/id="([^"]+)"/);
    if (!idMatch) throw new Error('no challenge id in 402');
    const r2 = await fetch(`${AGENT_BACKEND_URL}/v4/memory/${entityKey}/extend`, {
      method: 'POST',
      headers: { Authorization: `Payment exact ${idMatch[1]} demo-receipt-${Date.now()}` },
    });
    if (!r2.ok) throw new Error(`extend failed: ${r2.status}`);
    return;
  }
  if (!r1.ok) throw new Error(`extend failed: ${r1.status}`);
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border border-outline-variant/30 bg-surface-container-low p-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">{label}</div>
      <div className="font-headline text-2xl font-bold">{value}</div>
      {hint && <div className="text-[11px] text-on-surface-variant">{hint}</div>}
    </div>
  );
}

function DecisionsStrip({ rows }: { rows: DecisionRow[] }) {
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-mono text-on-surface-variant">
        <span className="material-symbols-outlined text-[14px] text-tertiary">history</span>
        <span className="uppercase tracking-widest">recent decisions</span>
        <span className="rounded border border-tertiary/30 bg-tertiary/10 px-1.5 py-0.5 text-tertiary">entity-type=agent-decision</span>
      </div>
      <ul className="space-y-1 text-[12px]">
        {rows.map((r) => {
          const ageMs = Date.now() - r.createdAt;
          const ageStr = ageMs < 60_000 ? `${Math.floor(ageMs / 1000)}s` : ageMs < 3_600_000 ? `${Math.floor(ageMs / 60_000)}m` : `${Math.floor(ageMs / 3_600_000)}h`;
          const verdictColor = r.decision === 'use-prior' ? 'text-secondary' : 'text-primary';
          return (
            <li key={r.entityKey} className="flex items-center gap-3 font-mono">
              <span className={`min-w-[80px] ${verdictColor}`}>{r.decision}</span>
              <span className="text-on-surface-variant">topic={r.topic}</span>
              <span className="text-on-surface-variant">priors={r.priorFactCount}</span>
              <span className="ml-auto text-on-surface-variant">{ageStr} ago</span>
              <a href={`${ARKIV_DATA_EXPLORER}?entityKey=${r.entityKey}`} target="_blank" rel="noopener noreferrer" className="text-on-surface-variant hover:text-tertiary">↗</a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MemoryCardRow({ card, onExtend }: { card: MemoryCard; now?: number; onExtend: () => void | Promise<void> }) {
  const conf = Number(card.attributes.confidence ?? 0);
  const topic = String(card.attributes.topic ?? '—');
  const sourceBrain = Number(card.attributes.sourceBrain ?? 0);
  const createdAt = Number(card.attributes.createdAt ?? 0);
  const ageMs = Date.now() - createdAt;
  const ageStr = ageMs < 60_000 ? `${Math.floor(ageMs / 1000)}s ago`
    : ageMs < 3_600_000 ? `${Math.floor(ageMs / 60_000)}m ago`
    : `${Math.floor(ageMs / 3_600_000)}h ago`;

  return (
    <div className="group rounded-xl border border-outline-variant/30 bg-surface p-4 transition-colors hover:border-primary/30">
      <div className="mb-2 flex items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-2 font-mono text-on-surface-variant">
          <span className="rounded border border-secondary/30 bg-secondary/10 px-1.5 py-0.5 text-secondary">topic={topic}</span>
          <span className="rounded border border-outline-variant/30 bg-surface-container px-1.5 py-0.5">conf {conf}</span>
          {card.confidential && <span className="rounded border border-tertiary/30 bg-tertiary/10 px-1.5 py-0.5 text-tertiary">🔒 confidential</span>}
        </div>
        <span className="font-mono text-on-surface-variant">{ageStr}</span>
      </div>

      <p className="mb-3 text-sm leading-relaxed">
        {card.confidential ? <span className="text-on-surface-variant italic">payload encrypted — provide aesKey to decrypt</span> : card.fact?.fact ?? '—'}
      </p>

      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-on-surface-variant">
        <Link href={`/marketplace?brain=${sourceBrain}`} className="hover:text-primary">brain #{sourceBrain}</Link>
        <span>·</span>
        <a href={`${ARKIV_DATA_EXPLORER}?entityKey=${card.entityKey}`} target="_blank" rel="noopener noreferrer" className="truncate hover:text-primary">{card.entityKey.slice(0, 14)}…</a>
        <a href={`${ARKIV_BLOCK_EXPLORER}/address/${card.fact?.signer ?? ''}`} target="_blank" rel="noopener noreferrer" className="hover:text-primary">signer ↗</a>
        <span className="ml-auto">
          <button onClick={onExtend} className="inline-flex items-center gap-1 rounded-full border border-secondary/40 bg-secondary/5 px-3 py-1 text-secondary transition-colors hover:bg-secondary/15">
            <span className="material-symbols-outlined text-[14px]">add</span>
            Extend +30d · $0.01
          </button>
        </span>
      </div>
    </div>
  );
}
