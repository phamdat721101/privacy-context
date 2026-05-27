'use client';

/**
 * /memory — live feed of agent memories on Arkiv-Braga.
 *
 * Why this page exists: showcases the moonshot narrative — agents accumulate
 * a queryable, tamper-proof public profile on Arkiv. Judges can verify any
 * card by clicking the explorer link (no Fhedin server in the trust path).
 *
 * Data flow:
 *   1. mount   → fetch all three lanes via `arkiv_query`.
 *   2. every REFRESH_MS → re-fetch (Arkiv RPC denies the filter-based
 *                        subscription methods, so we poll the data plane
 *                        directly — same UX, zero console noise).
 *   3. extend  → POST /v4/memory/:key/extend (402 → x402 receipt → 200).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  fetchMemoriesByAgent,
  fetchMyMemories,
  fetchDecisionsByAgent,
  ARKIV_BLOCK_EXPLORER,
  ARKIV_DATA_EXPLORER,
  ARKIV_PROJECT_ATTRIBUTE,
  MEMORY_AGENT_WALLET,
  type MemoryCard,
  type DecisionRow,
} from '@/lib/arkiv';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import { SovereignSaveForm } from '@/components/SovereignSaveForm';
import { MemoryChat } from '@/components/MemoryChat';
import { useArkivWallet } from '@/hooks/useArkivWallet';

type Lane = 'platform' | 'mine';
const LANES: Lane[] = ['platform', 'mine'];

const REFRESH_MS = 15_000;

export default function MemoryPage() {
  const arkiv = useArkivWallet();
  const userAddress = (arkiv.address ?? '').toLowerCase();
  const [lane, setLane] = useState<Lane>('platform');
  const [pendingChatPrompt, setPendingChatPrompt] = useState<string | null>(null);
  const [cards, setCards] = useState<MemoryCard[]>([]);
  const [myCards, setMyCards] = useState<MemoryCard[]>([]);
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [tickN, setTickN] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agentId = MEMORY_AGENT_WALLET;

  // URL ↔ state binding for the lane tab. Default to 'mine' when a user is
  // connected (their lane is more interesting); otherwise platform.
  useEffect(() => {
    try {
      const fromUrl = new URL(window.location.href).searchParams.get('lane');
      if (fromUrl === 'platform' || fromUrl === 'mine') setLane(fromUrl);
      else setLane(userAddress ? 'mine' : 'platform');
    } catch { /* SSR */ }
  }, [userAddress]);

  const switchLane = useCallback((next: Lane) => {
    setLane(next);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('lane', next);
      window.history.replaceState({}, '', u.toString());
    } catch { /* SSR */ }
  }, []);

  // Initial fetch + 30s refresh for both lanes. Each fetch is independently
  // resilient — a transient `context cancelled` (React-StrictMode double
  // mount aborts the in-flight TCP connection in dev) on one read must not
  // take down the other. Errors are logged, never banner-promoted.
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    const memoriesP = fetchMemoriesByAgent(agentId as `0x${string}`, 50)
      .catch((e) => { console.warn('fetchMemoriesByAgent:', (e as Error).message); return [] as MemoryCard[]; });
    const decisionsP = fetchDecisionsByAgent(agentId as `0x${string}`, 10)
      .catch((e) => { console.warn('fetchDecisionsByAgent:', (e as Error).message); return [] as DecisionRow[]; });
    Promise.all([memoriesP, decisionsP]).then(([memories, decs]) => {
      if (!cancelled) { setCards(memories); setDecisions(decs); }
    });
    return () => { cancelled = true; };
  }, [agentId]);

  useEffect(() => {
    if (!userAddress) { setMyCards([]); return; }
    let cancelled = false;
    fetchMyMemories(userAddress as `0x${string}`, 50)
      .then((m) => { if (!cancelled) setMyCards(m); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [userAddress]);

  // Periodic refresh — every REFRESH_MS we re-fetch all three lanes via
  // `arkiv_query` (whitelisted, no block-range cap). This replaces
  // `subscribeEntityEvents`, which polls `eth_getLogs` with wide block
  // ranges that Arkiv's RPC rejects ("exceed max block range params") and
  // probes `eth_newFilter` (-32601). Polling-based UX is simpler and doesn't
  // pollute the DevTools console with red entries.
  useEffect(() => {
    if (!agentId) return;
    const tick = () => void refreshSoon(setCards, setDecisions, setMyCards, agentId as `0x${string}`, userAddress as `0x${string}` | '');
    const handle = setInterval(tick, REFRESH_MS);
    return () => clearInterval(handle);
  }, [agentId, userAddress]);

  // 1-second TTL countdown ticker.
  useEffect(() => {
    const t = setInterval(() => setTickN((n) => (n + 1) % 1_000_000), 1000);
    return () => clearInterval(t);
  }, []);

  const activeCards = lane === 'mine' ? myCards : cards;
  const stats = useMemo(() => {
    const byTopic = new Map<string, number>();
    let plaintext = 0;
    let confidential = 0;
    for (const c of activeCards) {
      const topic = String(c.attributes.topic ?? 'unknown');
      byTopic.set(topic, (byTopic.get(topic) ?? 0) + 1);
      if (c.confidential) confidential += 1; else plaintext += 1;
    }
    return { topics: byTopic.size, plaintext, confidential, total: activeCards.length };
  }, [activeCards, tickN]);

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
          <h1 className="font-headline text-2xl font-bold">
            {lane === 'mine' ? 'Your chain memory' : 'Memory-Agent profile'}
          </h1>
          <span className="rounded-full border border-secondary/30 bg-secondary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-secondary">
            arkiv · braga
          </span>
        </div>

        <ActingAsChip
          address={arkiv.address}
          balanceWei={arkiv.balanceWei}
          needsFaucet={arkiv.needsFaucet}
          faucetUrl={arkiv.faucetUrl}
        />
        <p className="text-sm text-on-surface-variant">
          {lane === 'mine' ? (
            <>
              Save anything below. Your wallet signs every entity — Fhedin never holds the key.
              Each save is a real on-chain transaction on Arkiv-Braga, queryable by any tool that
              filters{' '}
              <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-xs">
                ownedBy({userAddress ? `${userAddress.slice(0, 8)}…` : '<your wallet>'})
              </code>.
            </>
          ) : (
            <>
              Every learned fact below is a public Arkiv entity tagged{' '}
              <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-xs">project={ARKIV_PROJECT_ATTRIBUTE}</code>.
              Read them yourself with a{' '}
              <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-xs">createPublicClient</code> —
              no Fhedin server in the trust path.
            </>
          )}
        </p>
        <dl className="grid grid-cols-3 gap-4 pt-2 text-xs">
          <Stat label="memories" value={stats.total} />
          <Stat label="topics" value={stats.topics} />
          <Stat label="confidential" value={stats.confidential} hint={`${stats.plaintext} plaintext`} />
        </dl>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <div className="inline-flex rounded-full border border-outline-variant/40 p-0.5 font-mono text-[11px]">
            {LANES.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => switchLane(l)}
                className={`rounded-full px-3 py-1 transition-colors ${
                  lane === l ? 'bg-secondary/15 text-secondary' : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {l === 'mine' ? 'Yours' : 'Platform'}
              </button>
            ))}
          </div>
          <a
            href={`${ARKIV_DATA_EXPLORER}?owner=${lane === 'mine' ? userAddress || agentId : agentId}`}
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

      {lane === 'mine' && (
        <>
          <SovereignSaveForm
            onSaved={(_entityKey, _txHash, topic) => {
              if (userAddress) fetchMyMemories(userAddress as `0x${string}`, 50).then(setMyCards).catch(() => undefined);
              // Auto-prefill the chat with a question about what was just saved.
              setPendingChatPrompt(`What did I just save about ${topic}?`);
            }}
            askMemory={(topic) => setPendingChatPrompt(`What did I just save about ${topic}?`)}
          />
          <MemoryChat
            ownedBy={(userAddress || null) as `0x${string}` | null}
            topicHints={Array.from(new Set(myCards.map((c) => String(c.attributes.topic ?? '')).filter(Boolean))).slice(0, 2)}
            prefill={pendingChatPrompt}
          />
        </>
      )}

      {lane === 'platform' && decisions.length > 0 && <DecisionsStrip rows={decisions} />}

      {activeCards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-10 text-center">
          <p className="text-on-surface-variant">
            {lane === 'mine'
              ? 'No memories yet. Paste something above and click Save — your wallet signs the on-chain tx.'
              : 'No platform memories yet. Boot the api with MEMORY_AGENT_ENABLED=true and publish a brain.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {activeCards.map((c) => (
            <MemoryCardRow
              key={c.entityKey}
              card={c}
              now={Date.now() + tickN * 0}
              onExtend={async () => {
                if (busy) return;
                setBusy(true);
                try {
                  await extendOne(c.entityKey);
                  if (lane === 'mine' && userAddress) {
                    setMyCards(await fetchMyMemories(userAddress as `0x${string}`, 50));
                  } else {
                    setCards(await fetchMemoriesByAgent(agentId as `0x${string}`, 50));
                  }
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            />
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
  setMyCards: (m: MemoryCard[]) => void,
  agentId: `0x${string}`,
  userAddress: `0x${string}` | '',
) {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(() => {
    fetchMemoriesByAgent(agentId, 50).then(setCards).catch(() => undefined);
    fetchDecisionsByAgent(agentId, 10).then(setDecisions).catch(() => undefined);
    if (userAddress) fetchMyMemories(userAddress, 50).then(setMyCards).catch(() => undefined);
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


// ─── Inline helpers (used only by this page) ────────────────────────────────

function ActingAsChip({
  address,
  balanceWei,
  needsFaucet,
  faucetUrl,
}: {
  address: `0x${string}` | null;
  balanceWei: bigint;
  needsFaucet: boolean;
  faucetUrl: string;
}) {
  if (!address) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-error/30 bg-error/10 px-3 py-1 font-mono text-[11px] text-error">
        <span className="material-symbols-outlined text-[14px]">link_off</span>
        not connected — sign in to act on this page
      </div>
    );
  }
  const glm = (Number(balanceWei) / 1e18).toFixed(4);
  const tone = needsFaucet ? 'tertiary' : 'secondary';
  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
      <span className={`inline-flex items-center gap-1.5 rounded-full border border-${tone}/40 bg-${tone}/10 px-3 py-1 text-${tone}`}>
        <span className="material-symbols-outlined text-[14px]">account_circle</span>
        you are acting as {address.slice(0, 6)}…{address.slice(-4)}
      </span>
      <span className="rounded-full border border-outline-variant/30 bg-surface-container-low px-2 py-1 text-on-surface-variant">
        {glm} GLM
      </span>
      {needsFaucet && (
        <a
          href={faucetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-full border border-tertiary/40 bg-tertiary/10 px-2 py-1 text-tertiary hover:bg-tertiary/20"
        >
          <span className="material-symbols-outlined text-[14px]">water_drop</span>
          top up GLM ↗
        </a>
      )}
      <span className="text-on-surface-variant">
        ↳ saves AND queries below use this exact wallet.
      </span>
    </div>
  );
}
