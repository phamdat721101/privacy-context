'use client';
import { useState } from 'react';
import Link from 'next/link';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import { createLogger } from '@/lib/clientLogger';

/**
 * Home — the single entrypoint into OpenX, the open gateway between people and
 * AI agents.
 *
 * Clean, centered, single-input hero (logo · one-line pitch · rounded input
 * with embedded submit · sample-prompt pills). Type a task → POST /v3/discover
 * → ranked agent cards replace the pills. Clicking a card routes straight to
 * that agent's task workspace (/agent/{id}/run?q=<task>) — not the detail
 * page — since the buyer has already described what they need; the task
 * text is prefilled there for review before running. No directory browse
 * here; that lives at /marketplace.
 *
 * SOLID:
 *   - SRP: this file owns "describe a task → see matches → jump straight to
 *     running one". Ranking is the server's job (/v3/discover); this renders
 *     request + response + the outbound link.
 *   - No crypto vocabulary is surfaced — price is plain "$X / task".
 */
const log = createLogger('home');

interface Candidate {
  /** v3 `agents.id` UUID — always populated. Used as the routing fallback
   *  when `brain_id` is null (wizard-published agents with no legacy
   *  `brains` row). See discoveryService.ts's `DiscoverResult` doc comment. */
  agent_id: string;
  brain_id: number | null;
  score: number;
  reason: string;
  persona_summary: string;
  pricing: Record<string, string | null>;
  chain: string;
}

interface DiscoverResult {
  candidates: Candidate[];
  bundle: { id: string; aggregate_price_usdc: string } | null;
}

const RAIL_ORDER = ['x402', 'mpp'] as const;

const SAMPLE_PROMPTS = [
  'Translate this NDA to Vietnamese',
  'Dedupe + enrich a CSV of 800 lead emails by industry',
  'Summarize 12 customer interviews into a positioning doc',
] as const;

function priceLabel(p: Record<string, string | null> | undefined): string {
  if (p) for (const k of RAIL_ORDER) if (p[k]) return `$${Number(p[k]).toFixed(2)} / task`;
  return 'Free preview';
}

function shortId(id: string) {
  return id.length <= 9 ? id : `${id.slice(0, 4)}…${id.slice(-3)}`;
}

export default function HomePage() {
  const [demand, setDemand] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DiscoverResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const message = demand.trim();
    if (!message || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${AGENT_BACKEND_URL}/v3/discover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, max_steps: 5 }),
      });
      if (!r.ok) throw new Error(`${r.status}`);
      const j = (await r.json()) as DiscoverResult;
      setResult(j);
      log.info('discover:ok', { len: message.length, hits: j.candidates.length });
    } catch (e: any) {
      setErr('Something went wrong matching your task. Try again or browse the marketplace.');
      log.warn('discover:failed', { err: e?.message });
    } finally {
      setBusy(false);
    }
  }

  const isEmpty = demand.trim().length === 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-10 px-4 py-12 md:py-16">
      {/* 1 · Logo */}
      <span className="text-primary" aria-hidden>
        <OpenXMark size={72} />
      </span>

      {/* 2 · One-line pitch */}
      <div className="space-y-3 text-center">
        <h1 className="font-headline text-4xl font-bold tracking-tight text-on-surface md:text-5xl">
          What do you need done today?
        </h1>
        <p className="text-base text-on-surface-variant md:text-lg">
          Describe it in plain English. An AI agent does the work and returns the result.
        </p>
      </div>

      {/* 3 · Single-line input with embedded submit */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="w-full max-w-2xl"
        aria-label="Describe your task"
      >
        <div className="relative">
          <input
            type="text"
            value={demand}
            onChange={(e) => setDemand(e.target.value)}
            placeholder="e.g., translate this NDA to Vietnamese"
            aria-label="Task description"
            className="h-16 w-full rounded-full border border-outline-variant/40 bg-surface-container-low px-6 pr-20 text-base text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            type="submit"
            disabled={busy || isEmpty}
            aria-label={busy ? 'Matching…' : 'Match agent'}
            className="absolute right-2 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <span
              className={`material-symbols-outlined text-[22px] ${busy ? 'animate-spin' : ''}`}
              aria-hidden
            >
              {busy ? 'autorenew' : 'arrow_forward'}
            </span>
          </button>
        </div>
      </form>

      {/* 4 · Sample pills — idle state only */}
      {isEmpty && !result && (
        <div className="flex flex-wrap justify-center gap-2">
          {SAMPLE_PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setDemand(p)}
              className="rounded-full border border-outline-variant/60 bg-surface-container-low px-4 py-2 text-sm text-on-surface-variant transition-colors hover:border-primary/60 hover:text-primary"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {err && (
        <p role="alert" className="text-sm text-error">
          {err}
        </p>
      )}

      {/* 5 · Results (replace pills post-submit) */}
      {result && (
        <section aria-live="polite" className="w-full">
          {result.candidates.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-outline-variant/60 p-8 text-center text-on-surface-variant">
              <p>No match yet. Try different wording — or browse the full catalog.</p>
              <div className="mt-3 flex flex-wrap justify-center gap-4">
                <Link href="/marketplace" className="text-sm text-primary hover:underline">
                  Browse marketplace →
                </Link>
                <Link href="/seller/onboard" className="text-sm text-primary hover:underline">
                  Publish an agent →
                </Link>
              </div>
            </div>
          ) : (
            <>
              <h2 className="mb-4 text-center text-lg font-semibold text-on-surface">
                {result.candidates.length} matching agent
                {result.candidates.length === 1 ? '' : 's'}
              </h2>
              <ul role="list" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {result.candidates.map((c, i) => {
                  // Route straight to the task workspace, never the detail
                  // page — the buyer already described their task, so the
                  // next click should let them run it, not re-orient on a
                  // "should I hire this agent?" page. brain_id is nullable
                  // (wizard-published agents have no legacy brains row);
                  // agent_id (the v3 agents.id UUID) is always populated
                  // and resolves via the same route (see lib/agents.ts's
                  // getAgent() brain-less fallback), so it's a safe
                  // fallback rather than the old dead-end /marketplace link.
                  const routeId = c.brain_id ?? c.agent_id;
                  const runHref = `/agent/${routeId}/run?q=${encodeURIComponent(demand.trim())}`;
                  return (
                  <li key={c.agent_id}>
                    <Link
                      href={runHref}
                      className="group flex h-full flex-col gap-3 rounded-2xl border border-outline-variant/40 bg-surface-container-low p-5 transition-colors hover:border-primary/60"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-2">
                          <span className="flex h-6 min-w-6 items-center justify-center rounded bg-primary px-1 font-mono text-[11px] text-on-primary">
                            #{i + 1}
                          </span>
                          <span className="font-mono text-on-surface-variant">
                            Agent {shortId(c.agent_id)}
                          </span>
                        </span>
                        <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-[11px] text-primary">
                          {(c.score * 100).toFixed(0)}%
                        </span>
                      </div>
                      {c.reason && (
                        <p className="line-clamp-2 text-xs italic text-on-surface-variant">
                          “{c.reason}”
                        </p>
                      )}
                      <p className="line-clamp-3 text-sm text-on-surface-variant">
                        {c.persona_summary?.trim() || 'AI agent matching your request.'}
                      </p>
                      <div className="mt-auto flex items-center justify-between border-t border-outline-variant/20 pt-3 font-mono text-xs text-on-surface">
                        <span>{priceLabel(c.pricing)}</span>
                        <span className="inline-flex items-center gap-1 uppercase text-primary">
                          Run this task
                          <span className="material-symbols-outlined text-[14px]" aria-hidden>
                            arrow_forward
                          </span>
                        </span>
                      </div>
                    </Link>
                  </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}

// Inline OpenX mark — reused from the header glyph so the homepage needs no new
// component file. Picks up `currentColor`.
function OpenXMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3L4 7L12 11L20 7L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 17L12 21L20 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 12L12 16L20 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
