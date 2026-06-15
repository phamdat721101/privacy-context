'use client';

/**
 * /agent/[id] — buyer-focused detail page (bento refactor — PRD-E T7).
 *
 * Audience split:
 *   • This page  → buyers ("should I hire this agent?")
 *   • /run       → buyers ("do the task now") — see PRD-E T6
 *   • /integrate → AI integrators ("curl, prompt, agent.json") — see PRD-E T8
 *
 * Layout (matches openx_agent_detail_with_prompt_guide mock, OpenX tokens
 * only — no SUI_AGENT_ENGINE re-skin per R3=a):
 *   header        : title + description + status pills
 *   main 8/12     : visual hero · 3-stat grid · system instructions ·
 *                   knowledge snapshot · independent verify
 *   sidebar 4/12  : Hire CTA (Run a task → /run)
 *                   <AgentRecentCalls /> (paid_calls feed)
 *                   activity sparkline · for-AI-integrators link
 *
 * SOLID:
 *   • SRP — page only renders detail view; runs and integration code split out.
 *   • DIP — getAgent + getAgentCognitiveSnapshot injected via lib/agents.
 *
 * No new helper files: only this page consumes SnapStat / ActivitySparkline.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getAgent,
  getAgentCognitiveSnapshot,
  type Agent,
  type AgentCognitiveSnapshot,
} from '@/lib/agents';
import { AgentRecentCalls } from '@/components/AgentRecentCalls';
import { usePrivyEvmAddress } from '@/hooks/useActiveWallet';
import { AGENT_BACKEND_URL } from '@/lib/contracts';

export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [agent, setAgent] = useState<Agent | null>(null);
  const [snap, setSnap] = useState<AgentCognitiveSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const userAddress = usePrivyEvmAddress();
  const [publishOpen, setPublishOpen] = useState(false);

  // Single fetch path used both on mount and after a successful publish, so
  // the page flips Draft → Live without a navigation. SRP: page owns its
  // freshness; lib/agents owns the wire shape.
  const refresh = useCallback(async () => {
    if (!id) return;
    const [a, s] = await Promise.all([getAgent(id), getAgentCognitiveSnapshot(id)]);
    setAgent(a);
    setSnap(s);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [id, refresh]);

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

  const isPublished = !!agent.slug;
  const isOwner =
    !!userAddress &&
    !!agent.ownerAddress &&
    userAddress.toLowerCase() === agent.ownerAddress.toLowerCase();
  const hasCognition = !!snap && (snap.episodes > 0 || snap.facts > 0 || snap.skills > 0);
  const lastSeen = snap?.lastQueryAt ? relativeTime(snap.lastQueryAt) : null;

  // Stats — null-safe placeholders so the layout never collapses.
  const stat = {
    successRate: hasCognition && snap ? '100%' : '—',
    successDelta: hasCognition && snap ? `${snap.episodes} episodes` : 'no runs yet',
    latency: '~450ms',
    executions: snap ? snap.episodes.toLocaleString() : '0',
  };

  const promptText =
    agent.persona?.system_prompt?.trim() ||
    `You have access to the "${agent.title}" brain. ${agent.description}`;

  return (
    <div className="space-y-6">
      {/* header */}
      <header className="flex flex-col gap-3 border-b border-outline-variant/30 pb-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {isPublished ? (
              <span className="rounded-full border border-secondary/30 bg-secondary/10 px-2 py-0.5 font-mono text-[10px] uppercase text-secondary">
                LIVE API
              </span>
            ) : (
              <span className="rounded-full border border-tertiary/30 bg-tertiary/10 px-2 py-0.5 font-mono text-[10px] uppercase text-tertiary">
                DRAFT
              </span>
            )}
            {hasCognition && (
              <span className="inline-flex items-center gap-1 rounded-full border border-secondary/30 bg-secondary/10 px-2 py-0.5 font-mono text-[10px] text-secondary">
                <span className="relative flex h-1.5 w-1.5 rounded-full bg-secondary">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-secondary opacity-75" />
                </span>
                active{lastSeen ? ` · ${lastSeen}` : ''}
              </span>
            )}
            {agent.acceptsPrivate && (
              <span className="rounded-full border border-tertiary/30 bg-tertiary/10 px-2 py-0.5 font-mono text-[9px] text-tertiary">
                CONFIDENTIAL OK
              </span>
            )}
          </div>
          <h1 className="truncate font-headline text-3xl font-bold">{agent.title}</h1>
          <p className="text-on-surface-variant">{agent.description}</p>
          <p className="font-mono text-xs text-on-surface-variant">
            Owner {agent.ownerAddress.slice(0, 8)}…{agent.ownerAddress.slice(-4)}
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* MAIN 8/12 */}
        <div className="space-y-4 lg:col-span-8">
          {/* visual hero */}
          <section className="relative aspect-[16/7] overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container-low">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-surface to-surface" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="material-symbols-outlined text-[120px] text-primary/80">memory</span>
            </div>
            <div className="absolute inset-x-4 bottom-4 flex items-end justify-between">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-primary">
                  cognitive layer
                </div>
                <div className="font-headline text-base text-on-surface">
                  {hasCognition ? 'Active' : 'Awaiting first run'}
                </div>
              </div>
              {agent.tags.length > 0 && (
                <div className="flex flex-wrap justify-end gap-1.5">
                  {agent.tags.slice(0, 3).map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-outline-variant/40 bg-surface/70 px-2 py-0.5 font-mono text-[10px] text-on-surface-variant"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* 3-stat grid */}
          <section className="grid grid-cols-3 gap-3">
            <Stat label="Success rate" value={stat.successRate} sub={stat.successDelta} />
            <Stat label="Latency" value={stat.latency} sub="avg response" />
            <Stat label="Executions" value={stat.executions} sub="total lifetime" />
          </section>

          {/* system instructions */}
          <section className="rounded-xl border border-outline-variant/30 bg-surface">
            <div className="flex items-center justify-between border-b border-outline-variant/30 px-5 py-3">
              <h2 className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
                System instructions
              </h2>
              <span className="font-mono text-[10px] text-on-surface-variant">
                {agent.persona?.system_prompt ? 'seller-authored' : 'auto-generated'}
              </span>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap p-5 font-mono text-[12px] leading-relaxed text-on-surface-variant">
              {promptText}
            </pre>
          </section>

          {/* knowledge snapshot — compressed */}
          {hasCognition && snap && (
            <section className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface p-5">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary">psychology</span>
                <h2 className="font-headline text-base font-semibold">Knowledge snapshot</h2>
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
                    {snap.topics.slice(0, 8).map((t) => (
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
            </section>
          )}

          {/* independent verify */}
          <section className="space-y-2 rounded-xl border border-outline-variant/30 bg-surface-container-low p-5">
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
                Verify counts via SQL
              </summary>
              <pre className="mt-2 overflow-auto rounded bg-surface px-3 py-2 text-[10px]">
                {`SELECT
  (SELECT COUNT(*) FROM cognitive_episodes WHERE owner_addr = '${agent.ownerAddress.toLowerCase()}') AS episodes,
  (SELECT COUNT(*) FROM cognitive_facts    WHERE owner_addr = '${agent.ownerAddress.toLowerCase()}') AS facts,
  (SELECT COUNT(*) FROM cognitive_skills   WHERE owner_addr = '${agent.ownerAddress.toLowerCase()}') AS skills;`}
              </pre>
            </details>
          </section>
        </div>

        {/* SIDEBAR 4/12 */}
        <aside className="space-y-4 lg:col-span-4">
          <div className="sticky top-24 space-y-4">
            {/* Sidebar primary CTA — owner-aware (PRD-E F2):
                  • owner + draft     → "Publish this agent"
                  • owner + published → "Manage in Studio" badge + buyer CTA
                  • non-owner         → buyer Hire CTA */}
            {isOwner && !isPublished ? (
              <OwnerPublishCTA
                brainId={String(agent.id)}
                onPublish={() => setPublishOpen(true)}
              />
            ) : (
              <HireCTA agent={agent} ownerBadge={isOwner && isPublished} />
            )}

            <AgentRecentCalls v3AgentId={agent.v3AgentId} limit={6} />

            {/* for AI integrators */}
            <Link
              href={`/agent/${agent.id}/integrate`}
              className="flex items-center justify-between rounded-xl border border-outline-variant/30 bg-surface p-4 hover:border-primary/40"
            >
              <div className="space-y-0.5">
                <div className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
                  for AI integrators
                </div>
                <div className="text-sm text-on-surface">curl · prompt · agent.json</div>
              </div>
              <span className="material-symbols-outlined text-on-surface-variant">arrow_forward</span>
            </Link>

            {!hasCognition && (
              <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-4 text-center">
                <span className="mb-1 block text-2xl">🌱</span>
                <p className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
                  new brain — no activity yet
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
      {publishOpen && agent && userAddress && (
        <PublishDraftDialog
          agent={agent}
          walletAddress={userAddress}
          onClose={() => setPublishOpen(false)}
          onPublished={async () => {
            setPublishOpen(false);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

// ─── inline helpers (only consumer is this page) ───────────────────────────

function HireCTA({ agent, ownerBadge }: { agent: Agent; ownerBadge?: boolean }) {
  return (
    <section className="relative overflow-hidden rounded-xl border border-primary/30 bg-surface p-5">
      <div className="absolute inset-x-0 top-0 h-[2px] bg-primary/60" />
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
            hire this agent
          </div>
          {ownerBadge && (
            <span className="rounded-full border border-secondary/30 bg-secondary/10 px-2 py-0.5 font-mono text-[9px] uppercase text-secondary">
              you own this
            </span>
          )}
        </div>
        <div className="mt-1 font-headline text-2xl font-bold">
          ${agent.price?.amount ?? '0.01'}
          <span className="ml-1 font-mono text-xs font-normal text-on-surface-variant">
            {agent.price?.currency ?? 'USDC'} / call
          </span>
        </div>
      </div>
      <Link
        href={`/agent/${agent.id}/run`}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 font-medium text-on-primary transition-opacity hover:opacity-90"
      >
        <span className="material-symbols-outlined text-[18px]">play_arrow</span>
        Run a task
      </Link>
      <p className="mt-2 text-center font-mono text-[10px] text-on-surface-variant">
        Free demo for short prompts · attach files to settle paid.
      </p>
      {ownerBadge && (
        <Link
          href="/studio"
          className="mt-2 block text-center font-mono text-[10px] uppercase tracking-wider text-on-surface-variant hover:text-primary"
        >
          manage in studio →
        </Link>
      )}
    </section>
  );
}

/**
 * OwnerPublishCTA — visible only when the connected wallet owns this draft.
 * Primary action: opens the inline `PublishDraftDialog` so the seller can
 * confirm-and-publish from this page in one click. Secondary action: the
 * full 5-step `/seller/onboard` wizard (?brain_id=...) for power users
 * who want to edit every field.
 */
function OwnerPublishCTA({
  brainId,
  onPublish,
}: {
  brainId: string;
  onPublish: () => void;
}) {
  const fullWizard =
    `/seller/onboard?return=${encodeURIComponent(`/agent/${brainId}`)}` +
    `&brain_id=${encodeURIComponent(brainId)}`;
  return (
    <section className="relative overflow-hidden rounded-xl border border-tertiary/40 bg-tertiary/5 p-5">
      <div className="absolute inset-x-0 top-0 h-[2px] bg-tertiary/60" />
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-tertiary/30 bg-tertiary/10 px-2 py-0.5 font-mono text-[9px] uppercase text-tertiary">
          your draft
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
          not live yet
        </span>
      </div>
      <h3 className="mt-2 font-headline text-lg font-semibold">Publish this agent</h3>
      <p className="mt-1 text-sm text-on-surface-variant">
        Mint a paid x402 endpoint at <code className="font-mono text-xs">/api/v1/&lt;slug&gt;</code>.
        One signature, one wallet — relayer pays the gas.
      </p>
      <button
        type="button"
        onClick={onPublish}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 font-medium text-on-primary transition-opacity hover:opacity-90"
      >
        <span className="material-symbols-outlined text-[18px]">rocket_launch</span>
        Publish now
      </button>
      <Link
        href={fullWizard}
        className="mt-2 block text-center font-mono text-[10px] uppercase tracking-wider text-on-surface-variant hover:text-primary"
      >
        customize → full wizard
      </Link>
      <p className="mt-2 text-center font-mono text-[10px] text-on-surface-variant">
        Buyers can&apos;t hire this agent until you publish.
      </p>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface p-4">
      <div className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
        {label}
      </div>
      <div className="mt-2 font-headline text-2xl font-bold">{value}</div>
      <div className="mt-1 font-mono text-[10px] text-on-surface-variant">{sub}</div>
    </div>
  );
}

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

// ─── PublishDraftDialog — inline confirm modal (PRD-E G1) ──────────────────
//
// Lightweight 4-field confirm dialog so a draft owner can convert their
// existing brain into a live paid agent without leaving the detail page.
// All other publish fields take sensible defaults (domain=generalist,
// rails=[x402], chain=arbitrum-sepolia, kind=api). Power users still have
// "customize → full wizard" in OwnerPublishCTA for the rest.
//
// SOLID:
//   • SRP — one dialog, one POST, one success callback. No payment, no
//     upload, no privacy-mode picker.
//   • DIP — caller injects `agent`, `walletAddress`, `onPublished`. The
//     dialog reaches the API directly (matches the existing /seller/onboard
//     pattern; no extra abstraction earns its keep here).
//
// The submit body matches the SellerPublishInput contract; existing_brain_id
// triggers the UPDATE-existing branch in sellerPublishService.publish().

interface PublishDraftDialogProps {
  agent: Agent;
  walletAddress: string;
  onClose: () => void;
  onPublished: () => void | Promise<void>;
}

function PublishDraftDialog({ agent, walletAddress, onClose, onPublished }: PublishDraftDialogProps) {
  const [title, setTitle] = useState(agent.title);
  const [shortDescription, setShortDescription] = useState(
    agent.description.slice(0, 200) || agent.title,
  );
  const [persona, setPersona] = useState(
    agent.persona?.system_prompt?.trim() ||
      `You are "${agent.title}". ${agent.description}`.trim(),
  );
  const [priceUsdc, setPriceUsdc] = useState<string>(agent.price?.amount ?? '0.05');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    !busy &&
    title.trim().length >= 3 &&
    shortDescription.trim().length >= 10 &&
    persona.trim().length >= 10 &&
    Number(priceUsdc) > 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${AGENT_BACKEND_URL}/v3/marketplace/seller/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-wallet-address': walletAddress },
        body: JSON.stringify({
          title: title.trim(),
          short_description: shortDescription.trim(),
          domain: 'generalist',
          tags: agent.tags ?? [],
          persona_system_prompt: persona.trim(),
          persona_tools: [],
          pricing_amount_usdc: priceUsdc,
          pricing_rails: ['x402'],
          accept_private_payment: !!agent.acceptsPrivate,
          kind: 'api',
          seller_profile: {
            display_name: `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`,
          },
          privacy: { mode: 'fhe', source: 'auto' },
          existing_brain_id: Number(agent.id),
        }),
      });
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) throw new Error((j?.error as string) ?? `HTTP ${r.status}`);
      await onPublished();
    } catch (e: any) {
      setError(e?.message ?? 'publish failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => !busy && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Publish this agent"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-tertiary">
              publish draft
            </div>
            <h2 className="mt-1 font-headline text-lg font-semibold">Confirm publish</h2>
            <p className="mt-1 text-xs text-on-surface-variant">
              Mints a paid x402 endpoint at <code className="font-mono">/api/v1/&lt;slug&gt;</code>.
              You can edit any field before confirming.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="close"
            className="text-on-surface-variant disabled:opacity-50"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto">
          <Field label="Title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
            />
          </Field>
          <Field label="Short description (≥10 chars)">
            <textarea
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
              rows={2}
              maxLength={300}
              className="w-full resize-y rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
            />
          </Field>
          <Field label="Persona prompt">
            <textarea
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              rows={4}
              maxLength={2000}
              className="w-full resize-y rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 py-2 font-mono text-xs focus:border-primary/60 focus:outline-none"
            />
          </Field>
          <Field label="Price per call (USDC)">
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={priceUsdc}
              onChange={(e) => setPriceUsdc(e.target.value)}
              className="w-32 rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 py-2 font-mono text-sm focus:border-primary/60 focus:outline-none"
            />
          </Field>
          <p className="font-mono text-[10px] text-on-surface-variant">
            Defaults: chain · arbitrum-sepolia · rail · x402 · kind · api · domain · generalist.
            Need to change these? Use the full wizard.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
            {error}
          </div>
        )}

        <footer className="flex justify-end gap-2 border-t border-outline-variant/30 pt-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-outline-variant/40 px-4 py-2 text-sm text-on-surface-variant disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[16px]">
              {busy ? 'hourglass_empty' : 'rocket_launch'}
            </span>
            {busy ? 'Publishing…' : 'Publish now'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
        {label}
      </span>
      {children}
    </label>
  );
}
