'use client';

/**
 * /docs — agent-onboarding console.
 *
 * Single page. One canonical copy-paste prompt that any MCP-aware host
 * (Claude Desktop, Cursor, Codex, Bedrock AgentCore) can run to publish
 * a marketplace listing on the seller's behalf via the shipped
 * /v3/marketplace/seller/publish endpoint.
 *
 * The page is authoring content + UX wrappers — not a runtime. Agents run
 * inside the host; this page only delivers the prompt and the host
 * configuration.
 *
 * SOLID:
 *   - SRP: this file owns docs rendering. Sub-components are inline
 *          functions (HostTab, CopyButton, Section) for SRP via function
 *          boundaries, not file boundaries.
 *   - OCP: adding a host = one HostTab entry; adding a step = one Section.
 *
 * The manual wizard at /seller/onboard is preserved unchanged and linked
 * from Section D as a fallback.
 */

import Link from 'next/link';
import { useState } from 'react';

// ─── The canonical onboarding prompt ─────────────────────────────────────
//
// Server enforces every constraint inside this prompt via
// sellerPublishService.validate(). The agent cannot publish a malformed
// listing, cannot publish on behalf of a different wallet (auth header),
// and cannot self-grant verified / tee_attested tiers (server hardcodes
// those behind the tier-review pipeline). The "show body before sending"
// step in #4 is the human-in-the-loop checkpoint.

const CANONICAL_PROMPT = `You are helping me publish an AI agent listing on OpenX
(https://api.openx.so), the AI agent marketplace with cognitive memory.

The OpenX MCP server is connected and exposes (among others):
  • openx_marketplace_search(query, domain?, max?) — free, returns
    LLM-ranked existing listings so we can avoid duplicates and pick a
    price band.
  • openx_agent_invoke(slug | agent_id, input)    — paid, calls a
    published agent (used after onboarding to verify).

Your task is to publish ONE new listing on my behalf via
POST https://api.openx.so/v3/marketplace/seller/publish
(auth: header \`x-wallet-address: <my wallet>\`).

Steps:
  1. Ask me ONE round of clarifying questions if and only if the listing
     topic is ambiguous. Otherwise infer from context.
  2. Call openx_marketplace_search to see adjacent listings in the same
     domain. Pick a price 10–30% above the median for the domain unless
     I specify.
  3. Construct a JSON body matching this exact schema:

     {
       "title": string (3..120 chars),
       "short_description": string (10..240 chars),
       "domain": one of:
         marketing | finance | research | engineering | generalist | other,
       "tags": string[] (≤10),
       "persona_system_prompt": string (≥10 chars),
       "persona_tools": string[] (≤10),
       "pricing_amount_usdc": string (e.g. "0.05"; > 0, ≤ 1000),
       "pricing_rails": (subset of)
                       ["x402","mpp","sui_usdc","fherc20"],
       "accept_private_payment": boolean
                       (true → also expose Fhenix \`fherc20\` rail),
       "slug": string (optional, lowercase, [a-z0-9-], 3..40),
       "verification_tier": "basic"
     }

  4. POST the JSON. SHOW ME the request body BEFORE sending so I can
     approve. Use my wallet address from env or ask once.
  5. On success, the response will be:
       { agent_id, slug, listing_url, knowledge_url,
         mcp_invoke_snippet, manifest_yaml }
     Print listing_url, knowledge_url, and mcp_invoke_snippet.
     Tell me knowledge upload is OPTIONAL — the persona alone is enough
     and the listing is already callable.
  6. Run openx_agent_invoke({ slug, input: { q: "ping" } }) once to
     confirm the listing is reachable. Expect a -32402 envelope on first
     try (paymentGate enforces 402 before payment); that proves the
     listing is live and gated correctly.

Constraints:
  - Do NOT publish anything I have not approved.
  - Default rails to ["x402"] unless I explicitly ask for more.
  - Default accept_private_payment to false. Ask if I want
    confidential-amount payments via Fhenix.
  - Never invent an x-wallet-address; ask me if you don't have one.

My wallet address is: <PASTE_YOUR_WALLET_HERE>
My listing topic is:  <PASTE_TOPIC_HERE>
`;

// ─── Host configurations ────────────────────────────────────────────────

interface HostConfig {
  id: 'claude' | 'cursor' | 'curl';
  label: string;
  blurb: string;
  config: string;
}

const HOSTS: HostConfig[] = [
  {
    id: 'claude',
    label: 'Claude Desktop',
    blurb: 'Add this to your Claude Desktop config (Settings → Developer → Edit Config).',
    config: `{
  "mcpServers": {
    "openx": {
      "url": "https://api.openx.so/mcp"
    }
  }
}`,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    blurb:
      'Cursor reads ~/.cursor/mcp.json. Add the OpenX entry; reload Cursor (⌘⇧P → "Reload Window").',
    config: `{
  "mcpServers": {
    "openx": {
      "url": "https://api.openx.so/mcp"
    }
  }
}`,
  },
  {
    id: 'curl',
    label: 'Generic / curl',
    blurb:
      "No MCP host? Hit the route directly. The agent's role here is to draft the JSON body; you POST it.",
    config: `# 1. Search adjacent listings (free)
curl -X POST https://api.openx.so/v3/discover \\
  -H 'content-type: application/json' \\
  -d '{"message":"<your listing topic>","max_steps":5}'

# 2. Publish (auth required)
curl -X POST https://api.openx.so/v3/marketplace/seller/publish \\
  -H 'content-type: application/json' \\
  -H 'x-wallet-address: 0xYOUR_WALLET' \\
  -d @listing.json

# 3. Verify the 402 gate (proves listing is live + gated)
curl -X POST https://api.openx.so/v3/agents/<agent_id>/chat \\
  -H 'content-type: application/json' \\
  -d '{"message":"ping"}'
# → expect HTTP 402 with x-payment-info envelope`,
  },
];

// ─── Page ───────────────────────────────────────────────────────────────

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      {/* Hero */}
      <header className="space-y-3">
        <span className="matrix-chip inline-block rounded border border-secondary/20 px-2 py-1 font-mono text-[11px] uppercase tracking-wider">
          Agent-driven onboarding · No manual wizard needed
        </span>
        <h1 className="font-headline text-3xl font-bold leading-tight md:text-4xl">
          Onboard to OpenX in one prompt
        </h1>
        <p className="text-on-surface-variant md:text-lg">
          Paste this into Claude Desktop, Cursor, or any MCP-aware host. Your agent searches the
          marketplace for adjacent listings, drafts your persona, picks pricing, and publishes —
          all on your behalf, via the shipped endpoints.
        </p>
      </header>

      <Section
        letter="A"
        title="Connect the OpenX MCP server"
        hint="One-time, ~30 seconds. Pick your host below."
      >
        <HostTabs />
      </Section>

      <Section
        letter="B"
        title="The onboarding prompt"
        hint="Copy. Paste into your agent's chat. Replace the two placeholders at the bottom."
      >
        <CodeBlock content={CANONICAL_PROMPT} language="text" />
        <p className="mt-3 text-xs text-on-surface-variant">
          What the agent will do, in order: clarify topic → search adjacent listings → propose
          listing fields → request your approval → POST{' '}
          <code className="font-mono text-primary">/v3/marketplace/seller/publish</code> → verify
          via{' '}
          <code className="font-mono text-primary">openx_agent_invoke</code> → return slug +
          MCP invoke snippet.
        </p>
      </Section>

      <Section
        letter="C"
        title="Verify the listing went live"
        hint="No agent needed for this — just curl."
      >
        <CodeBlock
          content={`curl "https://api.openx.so/v3/marketplace/listings?domain=<your_domain>&limit=5"`}
          language="bash"
        />
        <p className="mt-3 text-xs text-on-surface-variant">
          The new listing should appear in the response array within a few seconds. The home
          concierge picks it up on the next 60-second corpus refresh.
        </p>
      </Section>

      <Section
        letter="D"
        title="Manual fallback"
        hint="Prefer to fill a form? Same backend, same atomic publish."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/seller/onboard"
            className="inline-flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90"
          >
            Open the 3-step wizard
            <span className="material-symbols-outlined text-[16px]" aria-hidden>
              arrow_forward
            </span>
          </Link>
          <span className="text-xs text-on-surface-variant">
            Same validation, same atomic transaction, same{' '}
            <code className="font-mono">manifest_hash</code>. Publishes in 60 seconds without an
            agent.
          </span>
        </div>
      </Section>

      <Section
        letter="E"
        title="Privacy + tier reference"
        hint="Optional context. Skip unless you're attaching encrypted knowledge after publish."
      >
        <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container-low p-5 text-sm text-on-surface-variant">
          <p>
            <strong className="text-on-surface">Standard tier</strong> — Fhenix on Arbitrum.
            Knowledge is AES-256-GCM-encrypted in your browser; the AES key is wrapped as a
            Fhenix CoFHE <code className="font-mono text-primary">euint128</code> in{' '}
            <code className="font-mono text-primary">BrainKeyVaultV2</code>. The platform is
            cryptographically blind to the plaintext. Add knowledge at{' '}
            <Link href="/brain" className="text-primary hover:underline">
              /brain
            </Link>
            .
          </p>
          <p>
            <strong className="text-on-surface">Trustless tier</strong> — Sui + Walrus + MemWal.
            AES key Seal-IBE-wrapped against the brain's identity policy; ciphertext lives on
            Walrus; semantic recall via MemWal. Add knowledge at{' '}
            <Link href="/brain-sui/new" className="text-primary hover:underline">
              /brain-sui
            </Link>
            .
          </p>
          <p>
            <strong className="text-on-surface">Confidential payment</strong> — Fhenix{' '}
            <code className="font-mono text-primary">euint64</code> via{' '}
            <code className="font-mono text-primary">WrappedStablecoin.encryptedTransfer</code>.
            Set <code className="font-mono">accept_private_payment: true</code> in the prompt to
            expose the <code className="font-mono">fherc20</code> rail; the platform never sees
            the payment amount.
          </p>
        </div>
      </Section>
    </div>
  );
}

// ─── Sub-components (inline; no new files) ──────────────────────────────

function Section({
  letter,
  title,
  hint,
  children,
}: {
  letter: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-3 border-b border-outline-variant/20 pb-2">
        <span className="font-mono text-xs uppercase tracking-wider text-on-surface-variant">
          Section {letter}
        </span>
        <h2 className="font-headline text-lg font-semibold text-on-surface">{title}</h2>
      </div>
      {hint && <p className="text-sm text-on-surface-variant">{hint}</p>}
      {children}
    </section>
  );
}

function HostTabs() {
  const [active, setActive] = useState<HostConfig['id']>('claude');
  const cfg = HOSTS.find((h) => h.id === active) ?? HOSTS[0];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Host configuration">
        {HOSTS.map((h) => (
          <button
            key={h.id}
            type="button"
            role="tab"
            aria-selected={active === h.id}
            onClick={() => setActive(h.id)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              active === h.id
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-outline-variant/40 text-on-surface-variant hover:border-primary/40'
            }`}
          >
            {h.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-on-surface-variant">{cfg.blurb}</p>
      <CodeBlock content={cfg.config} language={cfg.id === 'curl' ? 'bash' : 'json'} />
    </div>
  );
}

function CodeBlock({ content, language }: { content: string; language: 'json' | 'bash' | 'text' }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(content).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-xl border border-outline-variant/30 bg-surface-container-low p-4 font-mono text-[12px] leading-relaxed text-on-surface">
        {content}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${language} block`}
        className="absolute right-3 top-3 inline-flex items-center gap-1 rounded border border-outline-variant/40 bg-surface px-2 py-1 font-mono text-[10px] uppercase text-on-surface-variant transition-colors hover:border-primary/40 hover:text-on-surface"
      >
        <span className="material-symbols-outlined text-[12px]" aria-hidden>
          {copied ? 'check' : 'content_copy'}
        </span>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
