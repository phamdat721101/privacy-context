'use client';

/**
 * /seller/onboard — 3-step seller wizard (PRD-B).
 *
 * Single client component. Step 1 listing → Step 2 persona → Step 3 pricing
 * → atomic POST /v3/marketplace/seller/publish → success card with three
 * deeplinks (View listing, Add knowledge, Copy MCP snippet).
 *
 * SOLID:
 *   - SRP: one component owns wizard state. Sub-components are inline
 *          functions for stepwise composition without inflating file count.
 *   - DIP: all state lives in this component; the API endpoint is the
 *          single dependency. Tests can swap fetch via msw if needed.
 *
 * Privacy: knowledge upload is intentionally NOT in this wizard. The
 * success card deeplinks to /brain (Fhenix tier) or /brain-sui/<id>
 * (Trustless tier) so the encrypt + on-chain key-wrap step is an explicit
 * post-publish gesture.
 */

import Link from 'next/link';
import { useState } from 'react';
import { useActiveWallet } from '@/hooks/useActiveWallet';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import { createLogger } from '@/lib/clientLogger';

const log = createLogger('seller-onboard');

const DOMAINS = [
  { id: 'marketing', label: 'Marketing' },
  { id: 'finance', label: 'Finance' },
  { id: 'research', label: 'Research' },
  { id: 'engineering', label: 'Engineering' },
  { id: 'generalist', label: 'Generalist' },
  { id: 'other', label: 'Other' },
] as const;

type DomainId = (typeof DOMAINS)[number]['id'];

const RAILS = [
  { id: 'x402', label: 'x402 USDC (default — fastest, public)' },
  { id: 'sui_usdc', label: 'Sui USDC' },
  { id: 'mpp', label: 'MPP voucher' },
] as const;

type RailId = (typeof RAILS)[number]['id'];

interface PublishResult {
  agent_id: string;
  brain_id: number;
  slug: string;
  domain: DomainId;
  verification_tier: 'basic' | 'verified' | 'tee_attested';
  chain: string;
  listing_url: string;
  knowledge_url: string | null;
  mcp_invoke_snippet: string;
}

interface FormState {
  title: string;
  short_description: string;
  domain: DomainId;
  tags: string;
  persona_system_prompt: string;
  persona_tools: string;
  pricing_amount_usdc: string;
  pricing_rails: RailId[];
  accept_private_payment: boolean;
}

const INITIAL: FormState = {
  title: '',
  short_description: '',
  domain: 'generalist',
  tags: '',
  persona_system_prompt: '',
  persona_tools: '',
  pricing_amount_usdc: '0.05',
  pricing_rails: ['x402'],
  accept_private_payment: false,
};

function isStepValid(s: number, f: FormState): boolean {
  if (s === 1) {
    return (
      f.title.trim().length >= 3 &&
      f.short_description.trim().length >= 10 &&
      DOMAINS.some((d) => d.id === f.domain)
    );
  }
  if (s === 2) return f.persona_system_prompt.trim().length >= 10;
  if (s === 3) {
    return Number(f.pricing_amount_usdc) > 0 && f.pricing_rails.length >= 1;
  }
  return false;
}

export default function SellerOnboardPage() {
  const wallet = useActiveWallet();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [form, setForm] = useState<FormState>(INITIAL);

  function update<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }
  function toggleRail(r: RailId) {
    setForm((s) => ({
      ...s,
      pricing_rails: s.pricing_rails.includes(r)
        ? s.pricing_rails.filter((x) => x !== r)
        : [...s.pricing_rails, r],
    }));
  }

  async function submit() {
    if (!wallet?.address) {
      setErr('Connect a wallet to publish.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${AGENT_BACKEND_URL}/v3/marketplace/seller/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-wallet-address': wallet.address },
        body: JSON.stringify({
          title: form.title.trim(),
          short_description: form.short_description.trim(),
          domain: form.domain,
          tags: form.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 10),
          persona_system_prompt: form.persona_system_prompt.trim(),
          persona_tools: form.persona_tools
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 10),
          pricing_amount_usdc: form.pricing_amount_usdc,
          pricing_rails: form.pricing_rails,
          accept_private_payment: form.accept_private_payment,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) {
        throw new Error((j?.error as string) ?? `HTTP ${r.status}`);
      }
      const typed = j as unknown as PublishResult;
      setResult(typed);
      log.info('publish:ok', { slug: typed.slug });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      log.warn('publish:failed', { err: msg });
    } finally {
      setBusy(false);
    }
  }

  if (result) return <SuccessCard result={result} />;

  return (
    <div className="mx-auto max-w-2xl space-y-7 py-6 md:py-10">
      <header className="space-y-2">
        <span className="matrix-chip inline-block rounded border border-secondary/20 px-2 py-1 font-mono text-[11px] uppercase tracking-wider">
          Sell on OpenX
        </span>
        <h1 className="font-headline text-3xl font-bold leading-tight md:text-4xl">
          Publish your agent in 3 steps
        </h1>
        <p className="text-sm text-on-surface-variant md:text-base">
          Other agents pay you per query. Knowledge is encrypted in your browser; the platform
          never sees the data.
        </p>
      </header>

      <ol role="list" className="flex gap-2 text-xs">
        {[1, 2, 3].map((n) => {
          const stateClass =
            step === n
              ? 'border-primary text-primary'
              : step > n
              ? 'border-secondary/40 text-secondary'
              : 'border-outline-variant/30 text-on-surface-variant';
          return (
            <li
              key={n}
              aria-current={step === n ? 'step' : undefined}
              className={`flex flex-1 items-center gap-2 rounded border px-3 py-2 ${stateClass}`}
            >
              <span className="font-mono">{step > n ? '✓' : n}</span>
              {n === 1 ? 'Listing' : n === 2 ? 'Persona' : 'Pricing'}
            </li>
          );
        })}
      </ol>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!isStepValid(step, form)) return;
          if (step < 3) setStep((s) => (s + 1) as 1 | 2 | 3);
          else submit();
        }}
        onKeyDown={(e) => {
          // ⌘/Ctrl + Enter advances or submits.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            (e.currentTarget.querySelector('button[type=submit]') as HTMLButtonElement | null)?.click();
          }
        }}
        className="space-y-5 rounded-xl border border-outline-variant/30 bg-surface p-5 md:p-6"
      >
        {step === 1 && <Step1 form={form} update={update} />}
        {step === 2 && <Step2 form={form} update={update} />}
        {step === 3 && <Step3 form={form} update={update} toggleRail={toggleRail} />}

        {!wallet?.address && (
          <p role="alert" className="text-sm text-amber-500">
            Connect a wallet to enable publish. The wizard works without it; submission needs auth.
          </p>
        )}
        {err && (
          <p role="alert" className="text-sm text-amber-500">
            {err}
          </p>
        )}

        <div className="flex justify-between gap-2">
          <button
            type="button"
            disabled={step === 1 || busy}
            onClick={() => setStep((s) => (Math.max(1, s - 1) as 1 | 2 | 3))}
            className="rounded border border-outline-variant/40 px-4 py-2 text-sm text-on-surface-variant disabled:opacity-50"
          >
            Back
          </button>
          <button
            type="submit"
            disabled={!isStepValid(step, form) || busy || (step === 3 && !wallet?.address)}
            className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && (
              <span className="material-symbols-outlined animate-spin text-[16px]" aria-hidden>
                progress_activity
              </span>
            )}
            {busy ? 'Publishing…' : step < 3 ? 'Next →' : 'Publish to marketplace'}
          </button>
        </div>
      </form>

      <p className="text-center text-xs text-on-surface-variant">
        Tip: ⌘/Ctrl + Enter to advance.
      </p>
    </div>
  );
}

// ─── Steps ───────────────────────────────────────────────────────────────

function Step1({
  form,
  update,
}: {
  form: FormState;
  update: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
}) {
  return (
    <>
      <Field label="Title" hint="3..120 chars">
        <input
          value={form.title}
          onChange={(e) => update('title', e.target.value)}
          maxLength={120}
          placeholder="Marketing competitor researcher"
          className="w-full rounded border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-on-surface focus:border-primary/60 focus:outline-none"
          required
        />
      </Field>
      <Field label="Short description" hint="10..240 chars · shown on the listing card">
        <textarea
          value={form.short_description}
          onChange={(e) => update('short_description', e.target.value)}
          maxLength={240}
          rows={2}
          placeholder="Researches competitors and outputs a one-page brief with positioning, pricing, and content gaps."
          className="w-full resize-none rounded border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-on-surface focus:border-primary/60 focus:outline-none"
          required
        />
      </Field>
      <Field label="Domain">
        <select
          value={form.domain}
          onChange={(e) => update('domain', e.target.value as DomainId)}
          className="w-full rounded border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-on-surface"
        >
          {DOMAINS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Tags" hint="comma-separated, optional · ≤10">
        <input
          value={form.tags}
          onChange={(e) => update('tags', e.target.value)}
          placeholder="seo, b2b, saas"
          className="w-full rounded border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-on-surface focus:border-primary/60 focus:outline-none"
        />
      </Field>
    </>
  );
}

function Step2({
  form,
  update,
}: {
  form: FormState;
  update: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
}) {
  return (
    <>
      <Field
        label="System prompt"
        hint="What this agent does, in 1–3 sentences. Buyers + concierge see this."
      >
        <textarea
          value={form.persona_system_prompt}
          onChange={(e) => update('persona_system_prompt', e.target.value)}
          rows={6}
          placeholder="You are a senior B2B SaaS analyst. Given a competitor URL, output a one-page brief with positioning, pricing, and content-gap analysis."
          className="w-full resize-none rounded border border-outline-variant/40 bg-surface-container-low px-3 py-2 font-mono text-sm text-on-surface focus:border-primary/60 focus:outline-none"
          required
        />
      </Field>
      <Field
        label="Tools"
        hint="comma-separated, optional · what this agent can call (e.g. web_search, fetch_url)"
      >
        <input
          value={form.persona_tools}
          onChange={(e) => update('persona_tools', e.target.value)}
          placeholder="web_search, fetch_url"
          className="w-full rounded border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-on-surface focus:border-primary/60 focus:outline-none"
        />
      </Field>
    </>
  );
}

function Step3({
  form,
  update,
  toggleRail,
}: {
  form: FormState;
  update: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  toggleRail: (r: RailId) => void;
}) {
  return (
    <>
      <Field label="Price per call" hint="USDC, 0..1000">
        <input
          type="number"
          step="0.01"
          min="0.001"
          max="1000"
          value={form.pricing_amount_usdc}
          onChange={(e) => update('pricing_amount_usdc', e.target.value)}
          className="w-full rounded border border-outline-variant/40 bg-surface-container-low px-3 py-2 font-mono text-on-surface focus:border-primary/60 focus:outline-none"
          required
        />
      </Field>
      <Field label="Payment rails" hint="At least one">
        <div className="space-y-1.5">
          {RAILS.map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-sm text-on-surface">
              <input
                type="checkbox"
                checked={form.pricing_rails.includes(r.id)}
                onChange={() => toggleRail(r.id)}
              />
              {r.label}
            </label>
          ))}
        </div>
      </Field>
      <details className="rounded border border-outline-variant/30 bg-surface-container-low px-3 py-2">
        <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">
          Advanced
        </summary>
        <label className="mt-2 flex items-start gap-2 text-sm text-on-surface">
          <input
            type="checkbox"
            checked={form.accept_private_payment}
            onChange={(e) => update('accept_private_payment', e.target.checked)}
            className="mt-1"
          />
          <span>
            Accept <strong>confidential payment</strong> (Fhenix FHE) — buyers can pay with an
            FHE-encrypted USDC amount via{' '}
            <code className="font-mono text-xs">WrappedStablecoin.encryptedTransfer</code>. The
            platform never sees the dollar amount.
          </span>
        </label>
      </details>
    </>
  );
}

// ─── Success card ────────────────────────────────────────────────────────

function SuccessCard({ result }: { result: PublishResult }) {
  const tierIsTrustless = result.chain.startsWith('sui');
  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8 md:py-12">
      <div className="rounded-xl border border-secondary/40 bg-secondary/5 p-6">
        <div className="mb-2 flex items-center gap-2 text-secondary">
          <span className="material-symbols-outlined" aria-hidden>
            check_circle
          </span>
          <span className="font-headline text-lg font-bold">Live on the marketplace</span>
        </div>
        <p className="text-sm text-on-surface-variant">
          Your agent <span className="font-mono text-primary">{result.slug}</span> is published.
          Other agents can now invoke it via MCP or HTTP.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href={`/agent/${result.brain_id}`}
            className="inline-flex items-center gap-1 rounded bg-primary px-4 py-2 text-sm text-on-primary"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden>
              arrow_forward
            </span>
            View listing
          </Link>
          {result.knowledge_url && (
            <Link
              href={result.knowledge_url}
              className="inline-flex items-center gap-1 rounded border border-outline-variant/40 px-4 py-2 text-sm text-on-surface"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden>
                {tierIsTrustless ? 'cloud' : 'enhanced_encryption'}
              </span>
              Add knowledge
            </Link>
          )}
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-1 rounded border border-outline-variant/40 px-4 py-2 text-sm text-on-surface-variant"
          >
            Browse marketplace
          </Link>
        </div>
        <p className="mt-4 text-xs text-on-surface-variant">
          {tierIsTrustless
            ? 'Your agent currently answers using its persona only. To attach encrypted knowledge: Sui wallet → register MemWal namespace → upload. Knowledge lands on Walrus + MemWal — sovereign storage anyone can verify without OpenX.'
            : 'Your agent currently answers using its persona only. To attach encrypted knowledge: sign a Fhenix permit (one-time, free) and upload. The platform never sees the plaintext.'}
        </p>
      </div>

      <div className="rounded-xl border border-outline-variant/30 bg-surface p-5">
        <h3 className="mb-2 font-mono text-xs uppercase tracking-wider text-on-surface-variant">
          MCP invoke snippet
        </h3>
        <pre className="overflow-x-auto rounded bg-surface-container-low p-3 font-mono text-xs leading-relaxed text-on-surface">
          {result.mcp_invoke_snippet}
        </pre>
      </div>
    </div>
  );
}

// ─── Atoms ───────────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-on-surface">{label}</span>
        {hint && <span className="font-mono text-[11px] text-on-surface-variant">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
