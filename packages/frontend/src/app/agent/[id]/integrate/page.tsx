'use client';

/**
 * /agent/[id]/integrate — AI-integrator hero (curl, prompt, agent.json).
 *
 * Per PRD-E (R7) — moved out of /agent/[id] so the detail page stays buyer-
 * focused. Single file, owns its own helpers (CopyButton, Row,
 * autoGeneratePrompt). No new components/* file is justified yet because
 * this surface has exactly one consumer.
 *
 * SOLID:
 *   • SRP — page renders integrator-facing surface only.
 *   • OCP — adding a "Bundle snippet v2" card is a sibling section, not a refactor.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import { getAgent, type Agent } from '@/lib/agents';

interface AgentJson {
  name: string;
  description: string;
  url: string;
  payTo: string;
  chain: string;
  asset: string;
  tools: Array<{ name: string; price: number; currency: string }>;
  system_prompt?: string | null;
}

export default function AgentIntegratePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [agent, setAgent] = useState<Agent | null>(null);
  const [agentJson, setAgentJson] = useState<AgentJson | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getAgent(id)
      .then(setAgent)
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!agent?.slug) return;
    fetch(`${AGENT_BACKEND_URL}/api/v1/${agent.slug}/.well-known/agent.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setAgentJson)
      .catch(() => setAgentJson(null));
  }, [agent?.slug]);

  if (loading) {
    return <div className="py-20 text-center text-on-surface-variant">Loading…</div>;
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

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div className="min-w-0 space-y-6 md:col-span-2">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-outline-variant/30 pb-4">
          <div className="min-w-0 space-y-1">
            <Link
              href={`/agent/${agent.id}`}
              className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant hover:text-primary"
            >
              <span className="material-symbols-outlined text-[14px]">arrow_back</span>
              back to detail
            </Link>
            <span className="block font-mono text-[10px] uppercase tracking-wider text-primary">
              // for AI integrators
            </span>
            <h1 className="truncate font-headline text-2xl font-bold">
              Integrate {agent.title}
            </h1>
          </div>
        </header>
        <PaidApiHero agent={agent} agentJson={agentJson} isDraft={!agent.slug} />
        {agent.slug && <AgentFAQ agent={agent} agentJson={agentJson} />}
      </div>
      <aside className="min-w-0">
        <div className="sticky top-24 space-y-4">
          {agent.slug ? (
            <Quickstart agent={agent} agentJson={agentJson} />
          ) : (
            <DraftIntegrateSidebar />
          )}
        </div>
      </aside>
    </div>
  );
}

// ─── PaidApiHero ───────────────────────────────────────────────────────────
function PaidApiHero({
  agent,
  agentJson,
  isDraft = false,
}: {
  agent: Agent;
  agentJson: AgentJson | null;
  isDraft?: boolean;
}) {
  const apiBase = AGENT_BACKEND_URL;
  const slug = agent.slug ?? 'your-slug';
  const url = `${apiBase}/api/v1/${slug}`;
  const curl = `curl '${url}?q=YOUR_QUESTION_HERE'`;
  const sampleResp = JSON.stringify(
    { answer: 'string', citations: [0, 1, 2], settled: { method: 'exact' } },
    null,
    2,
  );
  const promptBody =
    agent.persona?.system_prompt?.trim() || autoGeneratePrompt(agent, url);
  const bundleSnippet = JSON.stringify(
    {
      tool: 'ask',
      agent_url: url,
      price_usdc: agent.price?.amount ?? '0.01',
      args: { question: '{{user_input}}' },
      ...(agent.acceptsPrivate ? { confidential: true } : {}),
    },
    null,
    2,
  );

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-xl border border-primary/30 bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="font-headline text-base font-semibold">Make a call</h2>
            {isDraft && (
              <span className="rounded-full border border-tertiary/30 bg-tertiary/10 px-2 py-0.5 font-mono text-[9px] uppercase text-tertiary">
                draft — publish to activate
              </span>
            )}
          </div>
          {isDraft ? (
            <Link
              href="/studio/publish"
              className="rounded-full bg-primary px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-on-primary hover:opacity-90"
            >
              Run publish wizard
            </Link>
          ) : (
            <CopyButton value={curl} label="Copy curl" />
          )}
        </div>
        <pre className="overflow-x-auto rounded-lg bg-surface-container-low p-3 font-mono text-[12px] leading-relaxed">
          <code>{curl}</code>
        </pre>
        <div className="text-xs text-on-surface-variant">
          {isDraft
            ? 'Once published, this URL serves 402 Payment Required on the first call — the n-payment SDK settles via x402 and retries. Response shape after 200:'
            : 'Returns 402 Payment Required on the first call — the n-payment SDK settles via x402 and retries with the receipt. After 200, response shape:'}
        </div>
        <pre className="overflow-x-auto rounded-lg bg-surface-container-low p-3 font-mono text-[11px] text-on-surface-variant">
          <code>{sampleResp}</code>
        </pre>
      </div>

      <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-headline text-base font-semibold">Agent prompt</h2>
          <CopyButton value={promptBody} label="Copy" />
        </div>
        <p className="text-xs text-on-surface-variant">
          Paste this into Claude / ChatGPT to give the agent the context it needs to call your API.
        </p>
        <pre className="overflow-auto whitespace-pre-wrap rounded-lg bg-surface-container-low p-3 font-mono text-[12px] leading-relaxed">
          {promptBody}
        </pre>
      </div>

      <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-headline text-base font-semibold">Bundle snippet</h2>
            <span className="rounded-full border border-secondary/30 bg-secondary/10 px-2 py-0.5 font-mono text-[9px] uppercase text-secondary">
              for your agent
            </span>
          </div>
          <CopyButton value={bundleSnippet} label="Copy JSON" />
        </div>
        <p className="text-xs text-on-surface-variant">
          Drop this step into your own bundle manifest to invoke this agent as part of an
          autonomous workflow. The buyer&apos;s runner pays per call automatically.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-surface-container-low p-3 font-mono text-[12px] leading-relaxed">
          <code>{bundleSnippet}</code>
        </pre>
      </div>

      {!isDraft && (
        <details className="group rounded-xl border border-outline-variant/30 bg-surface p-5">
          <summary className="flex cursor-pointer items-center justify-between font-headline text-base font-semibold">
            <span>agent.json (auto-discovery)</span>
            <span className="font-mono text-[10px] text-on-surface-variant group-open:hidden">expand →</span>
            <span className="hidden font-mono text-[10px] text-on-surface-variant group-open:inline">collapse ↓</span>
          </summary>
          <p className="mt-2 text-xs text-on-surface-variant">
            AI agents auto-fetch this URL to learn what the API does, how to pay, and where to send funds.
          </p>
          <a
            href={`${url}/.well-known/agent.json`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block break-all font-mono text-[11px] text-primary hover:underline"
          >
            {url}/.well-known/agent.json ↗
          </a>
          <pre className="mt-3 overflow-auto rounded-lg bg-surface-container-low p-3 font-mono text-[11px]">
            <code>{agentJson ? JSON.stringify(agentJson, null, 2) : 'Loading…'}</code>
          </pre>
        </details>
      )}
    </div>
  );
}

// ─── AgentFAQ ──────────────────────────────────────────────────────────────
function AgentFAQ({ agent, agentJson }: { agent: Agent; agentJson: AgentJson | null }) {
  const FAQ: Array<{ q: string; a: ReactNode }> = useMemo(() => {
    const chain = agentJson?.chain ?? 'arbitrum-sepolia';
    const asset = agentJson?.asset;
    const price = agent.price?.amount ?? '0.01';
    const currency = agent.price?.currency ?? 'USDC';
    return [
      {
        q: 'Does this brain require an API key?',
        a: (
          <>
            No. Authentication is the payment receipt: send{' '}
            <code className="font-mono text-on-surface">X-Payment: &lt;x402 receipt&gt;</code>.
          </>
        ),
      },
      {
        q: 'How does payment work?',
        a: (
          <>
            x402 on <code className="font-mono">{chain}</code>, asset{' '}
            {asset ? <code className="font-mono">{asset.slice(0, 10)}…</code> : 'USDC'}. The first
            request returns 402 with a <code className="font-mono">WWW-Authenticate</code> header.
            Pay via any x402 facilitator (default <code className="font-mono">facilitator.x402.rs</code>) and
            retry with the receipt — the n-payment SDK does this for you.
          </>
        ),
      },
      {
        q: 'What if my wallet is unfunded?',
        a: (
          <>
            The facilitator returns 402 again with{' '}
            <code className="font-mono">error=&quot;insufficient_balance&quot;</code>. Top up USDC (Circle
            faucet on testnet) and retry — no state change on our side.
          </>
        ),
      },
      {
        q: 'What if the brain returns an error?',
        a: (
          <>
            Non-2xx, non-402 responses do <strong>not</strong> consume payment. Receipts settle
            only on 2xx so retries are safe.
          </>
        ),
      },
      {
        q: 'How deterministic is the answer?',
        a: (
          <>
            Inference runs in a Phala TEE; an attestation hash is returned in{' '}
            <code className="font-mono">settled.attestation</code>. Responses are not deterministic
            across calls; citations index a stable ranked-chunk set per (brain, query) pair.
          </>
        ),
      },
      {
        q: 'What if the price changes?',
        a: (
          <>
            Always trust the live 402 response. Prices in{' '}
            <code className="font-mono">.well-known/agent.json</code> may be ≤60s stale (the
            response sets <code className="font-mono">Cache-Control: max-age=60</code>). Today:{' '}
            <strong>${price} {currency}</strong>/call.
          </>
        ),
      },
    ];
  }, [agent.price, agentJson]);

  return (
    <div className="space-y-2 rounded-xl border border-outline-variant/30 bg-surface p-5">
      <h2 className="font-headline text-base font-semibold">Questions agents ask</h2>
      <div className="divide-y divide-outline-variant/20">
        {FAQ.map((entry, i) => (
          <details key={i} className="group py-2">
            <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm hover:text-primary">
              <span>{entry.q}</span>
              <span className="font-mono text-[10px] text-on-surface-variant group-open:hidden">+</span>
              <span className="hidden font-mono text-[10px] text-on-surface-variant group-open:inline">−</span>
            </summary>
            <div className="mt-2 text-sm leading-relaxed text-on-surface-variant">{entry.a}</div>
          </details>
        ))}
      </div>
    </div>
  );
}

// ─── Quickstart sidebar ────────────────────────────────────────────────────
function Quickstart({ agent, agentJson }: { agent: Agent; agentJson: AgentJson | null }) {
  const price = agent.price?.amount ?? '0.01';
  const currency = agent.price?.currency ?? 'USDC';
  const chain = agentJson?.chain ?? 'arbitrum-sepolia';
  const payTo = agent.ownerAddress;
  const url = `${AGENT_BACKEND_URL}/api/v1/${agent.slug}`;
  const curl = `curl '${url}?q=hello'`;
  return (
    <div className="space-y-4 rounded-xl border border-primary/30 bg-surface p-6">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
          price per call
        </div>
        <div className="mt-1 font-headline text-2xl font-bold">
          ${price}
          <span className="ml-1 font-mono text-xs font-normal text-on-surface-variant">
            {currency}
          </span>
        </div>
        {agent.acceptsPrivate && (
          <span className="mt-1 inline-block rounded-full border border-tertiary/30 bg-tertiary/10 px-2 py-0.5 font-mono text-[9px] text-tertiary">
            CONFIDENTIAL OK
          </span>
        )}
      </div>
      <div className="space-y-2 border-t border-outline-variant/20 pt-3 text-xs">
        <Row label="network" value={chain} mono />
        {agentJson?.asset && <Row label="asset" value={`${agentJson.asset.slice(0, 8)}…`} mono />}
        <Row label="pay to" value={`${payTo.slice(0, 6)}…${payTo.slice(-4)}`} mono />
      </div>
      <div className="space-y-2 border-t border-outline-variant/20 pt-3">
        <Link
          href={`/agent/${agent.id}/run`}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-2 text-sm font-medium text-on-primary hover:bg-primary/90"
        >
          <span className="material-symbols-outlined text-[16px]">play_arrow</span>
          Run a task
        </Link>
        <CopyButton value={curl} label="Copy curl" full />
      </div>
    </div>
  );
}

function DraftIntegrateSidebar() {
  return (
    <div className="space-y-3 rounded-xl border border-tertiary/30 bg-surface p-6">
      <h3 className="font-headline text-base font-semibold">Not yet published</h3>
      <p className="text-sm text-on-surface-variant">
        Publish via Studio to activate <code className="font-mono">/api/v1/&lt;slug&gt;</code>.
      </p>
      <Link
        href="/studio/publish"
        className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:opacity-90"
      >
        Run publish wizard →
      </Link>
    </div>
  );
}

// ─── helpers (single home — used only by this page) ───────────────────────
function CopyButton({ value, label, full }: { value: string; label: string; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {/* clipboard blocked */}
      }}
      className={`rounded-full border border-outline-variant/40 px-3 py-1 font-mono text-[10px] uppercase tracking-wider hover:border-primary/40 hover:text-primary ${
        full ? 'flex w-full items-center justify-center' : ''
      }`}
    >
      {copied ? '✓ copied' : label}
    </button>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-on-surface-variant">{label}</span>
      <span className={mono ? 'font-mono text-on-surface' : 'text-on-surface'}>{value}</span>
    </div>
  );
}

function autoGeneratePrompt(agent: Agent, url: string): string {
  const tagsLine =
    agent.tags.length > 0
      ? `When the user asks about ${agent.tags.map((t) => `#${t}`).join(', ')}, call:\n`
      : `To use it, call:\n`;
  const priceLine = agent.price
    ? `(price: ${agent.price.amount} ${agent.price.currency} per call, paid via x402)`
    : `(free preview)`;
  return [
    `You have access to the "${agent.title}" knowledge brain${
      agent.description ? ` — ${agent.description}` : ''
    }.`,
    '',
    tagsLine + `  GET ${url}?q=<the question>`,
    `  ${priceLine}`,
    '',
    'The response shape is:',
    '  { "answer": string, "citations": number[], "settled": { "method": "exact" | "fherc20" } }',
    '',
    'Always cite the brain when its answer informs your reply.',
  ].join('\n');
}
