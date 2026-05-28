'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getAgent,
  getAgentCognitiveSnapshot,
  type Agent,
  type AgentCognitiveSnapshot,
} from '@/lib/agents';

/**
 * /agent/[id] — public brain detail page.
 *
 * Phase 1 cognitive-aware view. Renders ONLY data sourced from the database;
 * the prior hardcoded "$15/mo · ~2s · Standard · Arbitrum Sepolia · FHE
 * Verified" decoration is gone. When a brain has no cognitive activity yet,
 * the page falls back to the metadata-only view with a small "fresh brain"
 * notice — no broken sections, no fake numbers.
 */
export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [agent, setAgent] = useState<Agent | null>(null);
  const [snap, setSnap] = useState<AgentCognitiveSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([getAgent(id), getAgentCognitiveSnapshot(id)])
      .then(([a, s]) => {
        setAgent(a);
        setSnap(s);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="py-20 text-center text-on-surface-variant">Loading agent…</div>;
  }
  if (!agent) {
    return (
      <div className="py-20 text-center">
        <p className="text-on-surface-variant">Agent not found.</p>
        <Link href="/marketplace" className="mt-3 inline-block text-sm text-primary hover:underline">
          ← Back to marketplace
        </Link>
      </div>
    );
  }

  const hasCognition = !!snap && (snap.episodes > 0 || snap.facts > 0 || snap.skills > 0);
  const lastSeen = snap?.lastQueryAt ? relativeTime(snap.lastQueryAt) : null;

  return (
    <div className="grid gap-6 md:grid-cols-3">
      {/* Main column */}
      <div className="space-y-6 md:col-span-2">
        {/* Header — real metadata + activity indicator + Fhenix vault */}
        <div className="rounded-xl border border-outline-variant/30 bg-surface p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <span className="material-symbols-outlined text-[28px]">smart_toy</span>
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-headline text-2xl font-bold">{agent.title}</h1>
                {hasCognition && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-secondary/30 bg-secondary/10 px-2 py-0.5 font-mono text-[10px] text-secondary">
                    <span className="relative flex h-1.5 w-1.5 rounded-full bg-secondary">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-secondary opacity-75" />
                    </span>
                    active{lastSeen ? ` · ${lastSeen}` : ''}
                  </span>
                )}
              </div>
              <p className="font-mono text-xs text-on-surface-variant">
                Owner {agent.ownerAddress.slice(0, 8)}…{agent.ownerAddress.slice(-4)}
              </p>
              {snap?.fhenixVaultAddress && (
                <p className="font-mono text-[10px] text-on-surface-variant">
                  Fhenix vault{' '}
                  <code className="rounded bg-surface-container px-1.5 py-0.5 text-on-surface">
                    {snap.fhenixVaultAddress.slice(0, 10)}…{snap.fhenixVaultAddress.slice(-6)}
                  </code>
                </p>
              )}
            </div>
          </div>
          <p className="mt-6 text-on-surface-variant">{agent.description}</p>
          {agent.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {agent.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-outline-variant/40 px-2 py-0.5 font-mono text-xs text-on-surface-variant"
                >
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Knowledge Snapshot — appears only when there's data */}
        {hasCognition && snap && (
          <div className="space-y-4 rounded-xl border border-outline-variant/30 bg-surface p-6">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary">psychology</span>
              <h2 className="font-headline text-lg font-semibold">Knowledge snapshot</h2>
            </div>
            <dl className="grid grid-cols-3 gap-3">
              <SnapStat label="episodes" value={snap.episodes} />
              <SnapStat label="facts" value={snap.facts} />
              <SnapStat label="skills" value={snap.skills} />
            </dl>
            {snap.topics.length > 0 && (
              <div className="space-y-2">
                <div className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
                  top topics
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {snap.topics.map((t) => (
                    <span
                      key={t.key}
                      className="inline-flex items-center gap-1 rounded-full border border-outline-variant/40 px-2 py-0.5 font-mono text-[11px]"
                    >
                      <span className="text-on-surface">{t.key}</span>
                      <span className="text-on-surface-variant">×{t.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <ActivitySparkline data={snap.activity14d} />
          </div>
        )}

        {/* Skills — only if any are minted */}
        {snap && snap.recentSkills.length > 0 && (
          <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface p-6">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">bolt</span>
              <h2 className="font-headline text-lg font-semibold">Skills available</h2>
            </div>
            {snap.recentSkills.map((s) => (
              <div
                key={s.id}
                className="rounded-lg border border-outline-variant/30 bg-surface-container-low p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <code className="font-mono text-sm text-on-surface">{s.procedureKey}</code>
                  <span className="font-mono text-[10px] text-on-surface-variant">
                    {s.runCount} runs
                  </span>
                </div>
                <div className="mt-1 inline-flex items-center gap-1 rounded-full border border-outline-variant/40 bg-surface px-2 py-1 text-[10px]">
                  <span className="text-on-surface-variant">now:</span>
                  <span className="font-mono text-secondary">free</span>
                  <span className="text-on-surface-variant">·</span>
                  <span className="text-on-surface-variant">target:</span>
                  <span className="font-mono text-primary">{s.defaultPriceUsdc} USDC/run</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Attestation Feed — only if any runs happened */}
        {snap && snap.recentAttestations.length > 0 && (
          <div className="space-y-2 rounded-xl border border-outline-variant/30 bg-surface p-6">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary">shield</span>
              <h2 className="font-headline text-lg font-semibold">Recent attestations</h2>
            </div>
            <ul className="grid gap-1 font-mono text-[11px]">
              {snap.recentAttestations.map((a) => (
                <li
                  key={a.runId}
                  className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-surface-container-low"
                >
                  <span>▶ run #{a.runId}</span>
                  <code className="text-on-surface-variant">{a.attestation.slice(0, 16)}…</code>
                  <span className="text-on-surface-variant">{relativeTime(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Independent Verify — always renders, gives skeptics a copy-button */}
        <div className="space-y-2 rounded-xl border border-outline-variant/30 bg-surface-container-low p-6">
          <div className="flex items-center gap-2 text-on-surface-variant">
            <span className="material-symbols-outlined text-[18px] text-primary">lock</span>
            <span className="font-mono text-xs uppercase tracking-wider">independent verify</span>
          </div>
          <p className="text-sm text-on-surface-variant">
            This brain&apos;s knowledge is AES-256-GCM encrypted at rest; per-(owner, layer) keys
            are derived independently. No OpenX server can read raw L1 episodes, L2 facts, or L3
            skill manifests for any user other than the wallet that owns them.
          </p>
          <details className="text-xs">
            <summary className="cursor-pointer font-mono text-on-surface-variant hover:text-on-surface">
              Verify counts via SQL (no OpenX server in trust path)
            </summary>
            <pre className="mt-2 overflow-auto rounded bg-surface px-3 py-2 text-[10px]">
              {`SELECT
  (SELECT COUNT(*) FROM cognitive_episodes WHERE owner_addr = '${agent.ownerAddress.toLowerCase()}') AS episodes,
  (SELECT COUNT(*) FROM cognitive_facts    WHERE owner_addr = '${agent.ownerAddress.toLowerCase()}') AS facts,
  (SELECT COUNT(*) FROM cognitive_skills   WHERE owner_addr = '${agent.ownerAddress.toLowerCase()}') AS skills;`}
            </pre>
          </details>
        </div>

        {!hasCognition && (
          <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-6 text-center">
            <span className="mb-2 block text-3xl">🌱</span>
            <p className="font-headline font-semibold">New brain — no cognitive activity yet.</p>
            <p className="mt-1 text-xs text-on-surface-variant">
              When agents start querying this brain, episodes appear here automatically.
            </p>
          </div>
        )}
      </div>

      {/* Hire CTA — pricing now reflects real Phase 1 free + target chips */}
      <aside className="space-y-4">
        <div className="sticky top-24 space-y-4 rounded-xl border border-primary/30 bg-surface p-6">
          <div className="space-y-1">
            <div className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
              query pricing
            </div>
            <div className="flex items-center gap-2 text-2xl font-headline font-bold">
              <span className="text-secondary">free</span>
              <span className="font-mono text-xs font-normal text-on-surface-variant">phase 1</span>
            </div>
            <div className="text-xs text-on-surface-variant">
              Per-skill target prices appear above when bundles are minted.
            </div>
          </div>
          <Link
            href={`/chat/${agent.id}`}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 font-medium text-on-primary transition-colors hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-[18px]">chat</span>
            Chat
          </Link>
          <div className="space-y-2 border-t border-outline-variant/20 pt-4 text-xs text-on-surface-variant">
            <div className="flex items-center justify-between">
              <span>Episodes recorded</span>
              <span className="font-mono text-on-surface">{snap?.episodes ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Facts derived</span>
              <span className="font-mono text-on-surface">{snap?.facts ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Skills minted</span>
              <span className="font-mono text-on-surface">{snap?.skills ?? 0}</span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

// ─── Tiny helpers ───────────────────────────────────────────────────────────

function SnapStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-outline-variant/30 bg-surface-container-low p-3 text-center">
      <div className="font-headline text-2xl font-bold">{value}</div>
      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
        {label}
      </div>
    </div>
  );
}

function ActivitySparkline({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  return (
    <div className="space-y-1">
      <div className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
        14-day activity
      </div>
      <div className="flex h-8 items-end gap-0.5">
        {data.map((v, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm bg-secondary/40 transition-all"
            style={{ height: `${(v / max) * 100}%`, minHeight: '2px' }}
            title={`${v} episode${v === 1 ? '' : 's'}, ${13 - i}d ago`}
          />
        ))}
      </div>
    </div>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}
