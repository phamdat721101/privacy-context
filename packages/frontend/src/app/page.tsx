'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import { createLogger } from '@/lib/clientLogger';

/**
 * Home — PRD-F redesign matching `home-page/code.html`.
 *
 * Layout (top → bottom):
 *   1. Onboarding breadcrumb: 01 DESCRIBE OUTCOME › 02 MATCH AGENT
 *                              › 03 EXECUTE IN SANDBOX › 04 DELIVER
 *   2. Hero: "What outcome do you need delivered today?"
 *   3. Glass chat box (POST /v3/discover).
 *   4. Three click-to-fill sample-prompt cards (idle state).
 *   5. Ranked candidate cards (post-submit, replaces sample cards).
 *
 * No agent list / "top agents" grid — buyers want to type a task and see
 * results, not browse a directory. The marketplace lives at /marketplace.
 *
 * SOLID:
 *   - One file owns home rendering + local state. Sub-components are inline
 *     (SRP via sections within one file) to satisfy "no new files unless
 *     essential" (PRD-F constraint).
 *   - Reuses AppShell (header + footer). No header rewrite here.
 *   - /v3/discover is a public endpoint (auth-whitelisted), so this page
 *     works before any wallet has connected.
 */
const log = createLogger('home');

interface Candidate {
  agent_id: string;
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

const RAIL_LABEL: Record<string, string> = { x402: 'USDC', mpp: 'MPP' };

const SAMPLE_PROMPTS = [
  '5 Facebook ad variants in EN/VN from this product link: acme.com/p/lumen-lamp',
  'Dedupe + enrich this CSV of 800 lead emails by industry.',
  'Summarize 12 customer interviews into a positioning doc.',
] as const;

function priceFromPricing(p: Record<string, string | null> | undefined) {
  if (!p) return null;
  for (const k of ['x402', 'mpp'] as const) if (p[k]) return { rail: k, amount: p[k]! };
  return null;
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
      setErr(`${e?.message ?? e} — try a more specific demand or browse the marketplace.`);
      log.warn('discover:failed', { err: e?.message });
    } finally {
      setBusy(false);
    }
  }

  function clearResult() {
    setResult(null);
    setErr(null);
  }

  return (
    <div className="space-y-8 md:space-y-10">
      <Breadcrumb />
      <Hero />
      <ChatBox
        demand={demand}
        setDemand={setDemand}
        busy={busy}
        onSubmit={submit}
        hasResult={!!result}
        onClear={clearResult}
      />
      {err && (
        <p role="alert" className="-mt-4 text-center text-sm text-amber-500">
          {err}
        </p>
      )}
      {result ? (
        <ResultsSection result={result} />
      ) : (
        <SamplePromptsSection onPick={(p) => setDemand(p)} />
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function Breadcrumb() {
  const steps = [
    '01 · DESCRIBE OUTCOME',
    '02 · MATCH AGENT',
    '03 · EXECUTE IN SANDBOX',
    '04 · DELIVER',
  ];
  return (
    <ol
      aria-label="How OpenX works"
      className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-on-surface-variant/80"
    >
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span className={i === 0 ? 'text-primary' : ''}>{s}</span>
          {i < steps.length - 1 && <span aria-hidden className="opacity-40">›</span>}
        </li>
      ))}
    </ol>
  );
}

function Hero() {
  return (
    <header className="space-y-3">
      <h1 className="font-headline text-4xl font-bold leading-tight tracking-tight md:text-5xl">
        What outcome do you need delivered today?
      </h1>
      <p className="max-w-2xl text-base text-on-surface-variant md:text-lg">
        Describe the deliverable in plain English. We match your task to a
        developer-built agent, run it in a sandbox, and return structured
        output. You pay per execution.
      </p>
    </header>
  );
}

function ChatBox({
  demand,
  setDemand,
  busy,
  onSubmit,
  hasResult,
  onClear,
}: {
  demand: string;
  setDemand: (v: string) => void;
  busy: boolean;
  onSubmit: () => void;
  hasResult: boolean;
  onClear: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="glass-panel rounded-xl border border-outline-variant/40 transition-colors focus-within:border-primary/60"
    >
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">
          &gt;_ NEW REQUEST
        </span>
        {hasResult && (
          <button
            type="button"
            onClick={onClear}
            className="ml-auto rounded border border-outline-variant/40 px-2 py-0.5 font-mono text-[10px] uppercase text-on-surface-variant transition-colors hover:border-primary/40 hover:text-on-surface"
          >
            Clear
          </button>
        )}
      </div>
      <div className="p-4 pb-2">
        <textarea
          value={demand}
          onChange={(e) => setDemand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder="What outcome do you need delivered today? (e.g., translate this NDA to Vietnamese)"
          rows={5}
          aria-label="Describe what you need"
          className="min-h-[120px] w-full resize-none bg-transparent text-base text-on-surface placeholder:text-outline focus:outline-none"
        />
      </div>
      <div className="flex flex-col items-stretch justify-between gap-3 border-t border-white/5 px-4 py-3 sm:flex-row sm:items-center">
        <span className="hidden font-mono text-[11px] text-on-surface-variant sm:inline">
          ⌘↵ to run
        </span>
        <button
          type="submit"
          disabled={busy || !demand.trim()}
          className="inline-flex items-center justify-center gap-2 rounded bg-primary px-4 py-2 font-medium text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Matching…' : 'Match agent'}
          <span
            className={`material-symbols-outlined text-[18px] ${busy ? 'animate-spin' : ''}`}
            aria-hidden
          >
            {busy ? 'progress_activity' : 'arrow_forward'}
          </span>
        </button>
      </div>
    </form>
  );
}

function SamplePromptsSection({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <section aria-label="Sample prompts" className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {SAMPLE_PROMPTS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPick(p)}
          className="glass-panel group rounded border border-outline-variant/40 p-4 text-left transition-colors hover:border-primary/40"
        >
          <span
            className="mb-2 inline-flex items-center text-primary"
            aria-hidden
          >
            <span className="material-symbols-outlined text-[18px]">bolt</span>
          </span>
          <p className="text-sm text-on-surface-variant group-hover:text-on-surface">
            {p}
          </p>
        </button>
      ))}
    </section>
  );
}

function ResultsSection({ result }: { result: DiscoverResult }) {
  if (result.candidates.length === 0) {
    return (
      <section
        aria-live="polite"
        className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-10 text-center"
      >
        <p className="text-on-surface-variant">
          No exact match yet. Try different phrasing — or be the first to
          publish an agent for this task.
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-3">
          <Link href="/marketplace" className="text-sm text-primary hover:underline">
            Browse marketplace →
          </Link>
          <Link href="/seller/onboard" className="text-sm text-primary hover:underline">
            Publish an agent →
          </Link>
        </div>
      </section>
    );
  }
  return (
    <section aria-live="polite" aria-labelledby="result-h" className="space-y-4">
      <div className="flex items-end justify-between gap-2 border-b border-white/5 pb-3">
        <div>
          <h2 id="result-h" className="font-headline text-2xl font-bold">
            {result.candidates.length} matching agent
            {result.candidates.length === 1 ? '' : 's'}
          </h2>
          <p className="text-sm text-on-surface-variant">
            Ranked by relevance to your request.
          </p>
        </div>
        {result.bundle && (
          <Link
            href={`/bundles/${encodeURIComponent(result.bundle.id)}`}
            className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-sm text-on-primary hover:opacity-90"
          >
            ${Number(result.bundle.aggregate_price_usdc).toFixed(4)} · review bundle
          </Link>
        )}
      </div>
      <ul role="list" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {result.candidates.map((c, i) => (
          <li key={c.agent_id}>
            <ResultCard c={c} rank={i + 1} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ResultCard({ c, rank }: { c: Candidate; rank: number }) {
  const price = priceFromPricing(c.pricing);
  const description = c.persona_summary?.trim() || 'AI agent matching your request.';
  const href = `/marketplace?agent=${c.agent_id}`;
  return (
    <Link
      href={href}
      className="agent-card-border group flex h-full flex-col gap-3 rounded-xl bg-surface p-5"
    >
      <div className="flex items-start justify-between gap-3 border-b border-white/5 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 min-w-7 items-center justify-center rounded bg-primary px-1 font-mono text-xs text-on-primary">
            #{rank}
          </span>
          <h3 className="truncate font-headline text-base font-semibold leading-snug text-on-surface group-hover:text-primary">
            Agent {shortId(c.agent_id)}
          </h3>
        </div>
        <span
          className="rounded bg-primary/10 px-2 py-0.5 font-mono text-[11px] text-primary"
          title="Match score"
        >
          {(c.score * 100).toFixed(0)}%
        </span>
      </div>
      {c.reason && (
        <p className="line-clamp-2 text-xs italic text-on-surface-variant">“{c.reason}”</p>
      )}
      <p className="line-clamp-3 text-sm text-on-surface-variant">{description}</p>
      <div className="mt-auto flex items-end justify-between gap-2 border-t border-white/5 pt-3">
        <span className="font-mono text-xs text-on-surface">
          {price
            ? `$${Number(price.amount).toFixed(2)} ${RAIL_LABEL[price.rail] ?? price.rail}`
            : 'Free preview'}
        </span>
        <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase text-primary">
          Open
          <span className="material-symbols-outlined text-[14px]" aria-hidden>
            arrow_forward
          </span>
        </span>
      </div>
    </Link>
  );
}
