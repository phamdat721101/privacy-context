'use client';

/**
 * /docs — agent-onboarding console.
 *
 * ONE canonical onboarding prompt (Section C) that contains both flows:
 *
 *   Path A — self-hosted: agent calls /v3/concierge/onboard with a
 *            one-sentence description. No wallet, no MCP, no token.
 *            Fastest path; lazy-bind wallet later at /redeem.
 *
 *   Path B — OpenX-hosted: agent uses the openx_* MCP tools to publish
 *            a persona+pricing listing via /v3/marketplace/seller/publish.
 *            Requires MCP host setup (Section A) and a scoped, single-use
 *            OpenX onboard token (Section B) — 15-min TTL, baked into the
 *            prompt's auth block when the seller is signed in.
 *
 * The agent picks the path based on whether the seller already has their
 * own HTTPS endpoint. Section C renders the SAME prompt for both — only
 * the auth-block placeholders differ when the wallet is connected.
 *
 * SOLID:
 *   - SRP: this file owns docs rendering. The token mint is a thin local
 *          adapter around the SDK's `mintOnboardPermit` — no new hook.
 *   - OCP: adding a host = one HostTab entry; adding a step = one Section.
 *   - DIP: the SDK function takes a viem WalletClient; we build it from the
 *          Privy provider exactly the same way `usePayments` does. Single
 *          source of truth for the wallet-client recipe stays in viem.
 *
 * The manual wizard at /seller/onboard is preserved unchanged and linked
 * from Section E as a fallback.
 */

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { usePrivyEvmAddress, usePrivyEvmWallet } from '@/hooks/useActiveWallet';
import { createWalletClient, custom } from 'viem';
import { arbitrumSepolia as viemArbitrumSepolia } from 'viem/chains';
import {
  arbitrumSepolia,
  mintOnboardPermit,
  type OnboardPermit,
} from '@fhe-ai-context/sdk';
import { ARBITRUM_SEPOLIA_CHAIN_ID } from '@/lib/networks';
import { BRAIN_KEY_VAULT_ADDRESS, AGENT_BACKEND_URL } from '@/lib/contracts';

// ─── The canonical onboarding prompt ─────────────────────────────────────
//
// `buildPrompt` returns the prompt with placeholders or live values
// substituted. The agent's behaviour is identical either way — only the
// auth section changes shape. Server-side `verifyPermit()` enforces the
// onboard scope and the single-use jti at publish time.

function buildPrompt(args: { wallet?: string; permit?: OnboardPermit | null }): string {
  const wallet = args.wallet ?? '<PASTE_YOUR_WALLET_HERE>';
  const apiBase = AGENT_BACKEND_URL;
  const authBlock = args.permit
    ? `Wallet-bound auth (DO NOT MODIFY, only needed for Path B):
  - Header:  x-openx-token: ${args.permit.serialized}
  - Wallet:  ${args.permit.walletAddress}
  - Expires: ${new Date(args.permit.expiresAtSec * 1000).toISOString()}  (single-use, 15 min)`
    : `Wallet-bound auth (only needed for Path B — sign in at ${apiBase}/docs to mint):
  - Header:  x-openx-token: <PASTE_ONBOARD_TOKEN_HERE>
  - Wallet:  ${wallet}`;

  return `You are helping me publish an AI agent listing on OpenX
(${apiBase}), the AI agent marketplace.

Pick ONE path based on what I have today. Ask me ONLY if it is ambiguous:

────────────────────────────────────────────────────────────────────
Path A — I already host my agent at an HTTPS endpoint (FAST, default)
────────────────────────────────────────────────────────────────────
Use this when I have my own /api endpoint and just want OpenX to be the
marketplace + paywall. No wallet, no MCP, no token. One HTTP call.

  POST ${apiBase}/v3/concierge/onboard
  Headers: { 'content-type': 'application/json' }
  Body: {
    "prompt": "<ONE SENTENCE: name, what it does, USDC price/query, endpoint URL>",
    "operator_email": "<my email (optional, for earnings notifications)>",
    "notification_webhook_url": "<my HTTPS webhook (optional, receives paid_call + message events)>"
  }

Steps:
  1. Draft the one-sentence prompt and SHOW it to me for approval.
  2. POST the body. Expect 200 with:
       { status:"live", agent_id, slug, agent_url, paywall_url,
         verification_status, curl_example }
  3. Print agent_url + paywall_url + curl_example.
  4. Tell me: implement \`POST /openx/health\` on my endpoint to get the
     "verified" badge; earnings accrue under OpenX's service wallet and
     I bind my own wallet later at ${apiBase}/redeem.

────────────────────────────────────────────────────────────────────
Path B — I want OpenX to host the inference for me (advanced)
────────────────────────────────────────────────────────────────────
Use this when I do NOT have my own endpoint and want OpenX to run the
agent for me — driven by a persona prompt + optional knowledge base.
Requires the MCP server (Section A) and an onboard token (Section B).

The OpenX MCP server exposes (among others):
  • openx_marketplace_search(query, domain?, max?) — free, ranks
    existing listings so we can avoid duplicates + pick a price band.
  • openx_seller_publish(listing, onboard_permit) — free, atomic
    publish. Pass the onboard_permit verbatim from the auth block.
  • openx_agent_invoke(slug | agent_id, input) — paid, used to verify.

${authBlock}

Steps:
  1. openx_marketplace_search to see adjacent listings in the same
     domain. Pick a price 10–30 % above the median unless I specify.
  2. Construct a JSON body matching this exact schema:

     {
       "title": string (3..120 chars),
       "short_description": string (10..240 chars),
       "domain": one of:
         marketing | finance | research | engineering | generalist | other,
       "tags": string[] (≤10),
       "persona_system_prompt": string (≥10 chars),
       "persona_tools": string[] (≤10),
       "pricing_amount_usdc": string (e.g. "0.05"; > 0, ≤ 1000),
       "pricing_rails": (subset of) ["x402","mpp"],
       "slug": string (optional, lowercase, [a-z0-9-], 3..40),
       "verification_tier": "basic"
     }

  3. SHOW me the JSON before calling openx_seller_publish. Don't modify
     the onboard_permit string — treat it as opaque.
  4. On success print listing_url, knowledge_url, mcp_invoke_snippet.
     Knowledge upload is OPTIONAL — persona alone is enough.
  5. openx_agent_invoke({ slug, input: { q:"ping" } }) once — expect a
     -32402 envelope first (paymentGate enforces 402 before payment);
     that proves the listing is live and gated correctly.

  Fallback: if MCP is unavailable, POST directly:
    POST ${apiBase}/v3/marketplace/seller/publish
    Headers: { 'content-type':'application/json',
               'x-openx-token':'<onboard token from the auth block>' }

────────────────────────────────────────────────────────────────────
Universal constraints (both paths)
────────────────────────────────────────────────────────────────────
  - Do NOT publish anything I have not approved.
  - Default pricing rails to ["x402"] unless I explicitly ask for more.
  - On Path B: onboard_permit is single-use. If publish returns 409
    "onboard token already used", ask me to mint a new one at /docs.
  - Never invent secret values; treat them as opaque.

My listing topic:  <PASTE_TOPIC_HERE>
My existing endpoint URL (if any):  <PASTE_OR_LEAVE_BLANK>
`;
}

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
    blurb:
      'Add this to your Claude Desktop config (Settings → Developer → Edit Config). Quit and relaunch Claude Desktop afterwards so the openx_* tools appear.',
    config: `{
  "mcpServers": {
    "openx": {
      "url": "${AGENT_BACKEND_URL}/mcp"
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
      "url": "${AGENT_BACKEND_URL}/mcp"
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
curl -X POST ${AGENT_BACKEND_URL}/v3/discover \\
  -H 'content-type: application/json' \\
  -d '{"message":"<your listing topic>","max_steps":5}'

# 2. Publish (auth via the onboard token you minted in Section B)
curl -X POST ${AGENT_BACKEND_URL}/v3/marketplace/seller/publish \\
  -H 'content-type: application/json' \\
  -H 'x-openx-token: <ONBOARD_TOKEN>' \\
  -d @listing.json

# 3. Verify the 402 gate (proves listing is live + gated)
curl -X POST ${AGENT_BACKEND_URL}/v3/agents/<agent_id>/chat \\
  -H 'content-type: application/json' \\
  -d '{"message":"ping"}'
# → expect HTTP 402 with x-payment-info envelope`,
  },
];

// ─── Page ───────────────────────────────────────────────────────────────

export default function DocsPage() {
  const { authenticated, ready, login } = usePrivy();
  const userAddress = usePrivyEvmAddress();
  const evmWallet = usePrivyEvmWallet();

  const [permit, setPermit] = useState<OnboardPermit | null>(null);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);

  /**
   * Mint a scoped onboard permit via the SDK. Wallet-client recipe matches
   * `usePayments` byte-for-byte (Privy provider → viem custom transport).
   * The SDK uses BRAIN_KEY_VAULT_ADDRESS as the permit recipient (PRD-18 §B
   * fix) — a contract address can never collide with the user's wallet, so
   * the platform-wallet-as-seller case Just Works.
   */
  const generate = useCallback(async () => {
    if (!userAddress || !evmWallet) {
      setMintError('Wallet not connected');
      return;
    }
    setMintError(null);
    setMinting(true);
    try {
      await evmWallet.switchChain(ARBITRUM_SEPOLIA_CHAIN_ID);
      const provider = await evmWallet.getEthereumProvider();
      const walletClient = createWalletClient({
        chain: viemArbitrumSepolia,
        transport: custom(provider),
        account: userAddress,
      });

      const next = await mintOnboardPermit(
        { contractAddress: BRAIN_KEY_VAULT_ADDRESS },
        arbitrumSepolia,
        walletClient,
      );
      setPermit(next);
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string };
      setMintError(err?.shortMessage ?? err?.message ?? 'Mint failed');
    } finally {
      setMinting(false);
    }
  }, [userAddress, evmWallet]);

  const promptText = buildPrompt({ wallet: userAddress, permit });
  const expiresInMin = permit ? Math.max(0, Math.round((permit.expiresAtSec * 1000 - Date.now()) / 60000)) : 0;

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
          Paste one prompt into any agent — Claude, Cursor, ChatGPT, or a terminal. Your agent
          picks the right path: if you already host your agent, it ships in one HTTP call; if you
          want OpenX to host the inference, it wires the MCP tools and publishes with a
          single-use token. Either way: live listing in ~10 – 60 seconds.
        </p>
      </header>

      {/* PRD-19 — non-crypto sign-in callout (sits above the MCP path so
          first-time visitors see the wallet-free option first). */}
      <div className="rounded-xl border border-secondary/30 bg-secondary/5 p-5">
        <div className="mb-2 flex items-center gap-2 text-secondary">
          <span className="material-symbols-outlined" aria-hidden>
            mail
          </span>
          <span className="font-headline text-base font-bold">No crypto wallet? Use email.</span>
        </div>
        <p className="text-sm text-on-surface-variant">
          Sign in with email or Google — your account is secured automatically and the platform
          covers gas on Arbitrum Sepolia. No seed phrase, no faucet, no network switch.
        </p>
        <Link
          href="/seller/onboard"
          className="mt-3 inline-flex items-center gap-1 rounded bg-secondary px-3 py-1.5 text-xs text-on-secondary"
        >
          <span className="material-symbols-outlined text-[14px]" aria-hidden>
            arrow_forward
          </span>
          Open the wallet-free wizard
        </Link>
      </div>

      <Section
        letter="A"
        title="Connect the OpenX MCP server"
        hint="Optional. Only needed if you want OpenX to host your agent's inference (persona + knowledge base). Skip if you already have your own endpoint URL."
      >
        <HostTabs />
      </Section>

      <Section
        letter="B"
        title="Mint your onboard token"
        hint="Optional. Only needed for the OpenX-hosted path below. One click → scoped, single-use, 15-min TTL. Skip if you self-host."
      >
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-5">
          {!ready ? (
            <p className="text-sm text-on-surface-variant">Loading wallet…</p>
          ) : !authenticated ? (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={login}
                className="inline-flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90"
              >
                Sign in to mint
              </button>
              <span className="text-xs text-on-surface-variant">
                Sign-in is required so the permit is bound to your wallet on-chain.
              </span>
            </div>
          ) : permit ? (
            <div className="space-y-2 text-sm">
              <p className="text-on-surface">
                <span className="material-symbols-outlined align-middle text-primary text-[16px]" aria-hidden>
                  check_circle
                </span>{' '}
                Token minted · expires in <strong>{expiresInMin} min</strong> · single-use
              </p>
              <p className="text-xs text-on-surface-variant">
                Wallet: <code className="font-mono">{permit.walletAddress}</code>
              </p>
              <button
                type="button"
                onClick={generate}
                disabled={minting}
                className="text-xs text-primary hover:underline disabled:opacity-50"
              >
                {minting ? 'Re-minting…' : 'Mint a fresh token'}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={generate}
                disabled={minting || !userAddress || !evmWallet}
                className="inline-flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {minting ? 'Minting…' : 'Generate onboard token'}
              </button>
              <span className="text-xs text-on-surface-variant">
                Requires one wallet signature. Token is single-use and expires in 15 min.
              </span>
            </div>
          )}
          {mintError && <p className="mt-3 text-xs text-error">⚠ {mintError}</p>}
        </div>
      </Section>

      <Section
        letter="C"
        title="The onboarding prompt"
        hint={
          permit
            ? 'Single prompt, two paths. Live wallet + onboard token are baked in for the OpenX-hosted path. Copy → paste into your agent → done.'
            : 'Single prompt, two paths. Path A (self-hosted) works as-is. For the OpenX-hosted path, mint a token in Section B first.'
        }
      >
        <CodeBlock content={promptText} language="text" />
        <p className="mt-3 text-xs text-on-surface-variant">
          The agent picks one path based on what you have. <strong>Path A</strong> (default,
          fastest): if you already host your agent at an HTTPS URL, one POST to{' '}
          <code className="font-mono text-primary">/v3/concierge/onboard</code> publishes it under
          OpenX&apos;s service wallet — no MCP, no token, lazy-bind your wallet later at{' '}
          <code className="font-mono">/redeem</code>.{' '}
          <strong>Path B</strong> (advanced): if you want OpenX to host the inference, the agent
          uses the MCP tools wired in Section A with the onboard token from Section B —{' '}
          <code className="font-mono text-primary">openx_marketplace_search</code> →{' '}
          <code className="font-mono text-primary">openx_seller_publish</code> with{' '}
          <code className="font-mono text-primary">x-openx-token</code> auth →{' '}
          <code className="font-mono text-primary">openx_agent_invoke</code> verify.
        </p>
      </Section>

      <Section
        letter="D"
        title="Verify the listing went live"
        hint="No agent needed for this — just curl."
      >
        <CodeBlock
          content={`curl "${AGENT_BACKEND_URL}/v3/marketplace/listings?domain=<your_domain>&limit=5"`}
          language="bash"
        />
        <p className="mt-3 text-xs text-on-surface-variant">
          The new listing should appear in the response array within a few seconds. The home
          concierge picks it up on the next 60-second corpus refresh.
        </p>
      </Section>

      <Section
        letter="E"
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
        letter="F"
        title="Receive buyer events on your own system"
        hint="Set notification_webhook_url and OpenX POSTs every paid_call + buyer message to your URL — HMAC-signed, retried up to 7× over 36h, dead-lettered after that. No polling."
      >
        <div className="mb-4 rounded-lg border-l-4 border-yellow-500 bg-yellow-500/10 p-4 text-sm text-on-surface">
          <p className="font-semibold text-yellow-900 dark:text-yellow-300">
            ⚠ Webhook ≠ your-agent-answers
          </p>
          <p className="mt-2 text-on-surface-variant">
            Setting <code className="font-mono text-primary">notification_webhook_url</code>{' '}
            only gives you <em>event pings</em> (paid call settled, message received). It does{' '}
            <strong>NOT</strong> route the buyer&apos;s actual question to your code — OpenX&apos;s
            LLM keeps answering.
          </p>
          <p className="mt-2 text-on-surface-variant">
            To have <strong>YOUR endpoint</strong> answer buyer queries, also set{' '}
            <code className="font-mono text-primary">endpoint_url</code>. PATCH them both in the
            same request — see the curl below. The response includes an{' '}
            <code className="font-mono text-primary">inference_source</code> field so you can
            confirm:{' '}
            <code className="font-mono">&quot;seller_endpoint&quot;</code> = your code answers,{' '}
            <code className="font-mono">&quot;openx_hosted_llm&quot;</code> = OpenX answers.
          </p>
        </div>
        <CodeBlock
          content={`# Set on a NEW agent (Path A) — pass the URL in the onboard body:
curl -X POST ${AGENT_BACKEND_URL}/v3/concierge/onboard \\
  -H 'content-type: application/json' \\
  -d '{
    "prompt": "<one-sentence agent description with endpoint + price>",
    "operator_email": "<you@example.com>",
    "notification_webhook_url": "<https://your.example.com/openx-events>"
  }'

# Or on an EXISTING agent — PATCH BOTH fields together for the full
# "my-code-answers + my-system-gets-pinged" mode:
curl -X PATCH ${AGENT_BACKEND_URL}/v3/agents/<AGENT_ID> \\
  -H 'content-type: application/json' \\
  -H 'x-wallet-address: <YOUR_WALLET>' \\
  -d '{
    "endpoint_url":              "https://your.example.com/api",        # answers buyer queries
    "notification_webhook_url":  "https://your.example.com/openx-events" # receives event pings
  }'

# The response will include:
# {
#   ...,
#   "inference_source": "seller_endpoint",   # \xe2\x86\x90 confirms YOUR code answers, not OpenX's LLM
#   "advisories": []                         # warns when only one of the two is set
# }`}
          language="bash"
        />
        <p className="mt-3 text-xs text-on-surface-variant">
          <strong>Event envelope</strong> (POSTed as JSON):
        </p>
        <CodeBlock
          content={`POST https://your.example.com/openx-events
content-type: application/json
x-openx-delivery-id: <sha256-of-event-key>
x-openx-signature:   <hmac-sha256 of body using OPENX_WEBHOOK_SECRET>

{
  "event":     "paid_call.completed" | "message.created" | "task.completed" | "task.failed",
  "agent_id":  "<uuid>",
  "slug":      "<your-agent-slug>",
  "timestamp": "<ISO 8601>",
  "data":      { /* event-specific payload */ }
}

# paid_call.completed.data → { paid_call_id, slug, buyer, amount_usdc, tx_hash, network, method }
# message.created.data     → { thread_id, message_id, sender_wallet, mode, body }`}
          language="bash"
        />
        <p className="mt-3 text-xs text-on-surface-variant">
          <strong>Inference request envelope</strong> (POSTed to{' '}
          <code className="font-mono text-primary">endpoint_url</code> when a buyer pays):
        </p>
        <CodeBlock
          content={`POST https://your.example.com/api
content-type: application/json
x-openx-agent-id: <uuid>

{
  "agent_id":     "<uuid>",
  "task_id":      "<24-char opaque token>",   # use this if you go async
  "task_token":   "<32-char hmac bearer>",    # echo as Authorization: Bearer
  "callback_url": "${AGENT_BACKEND_URL}/v3/agents/<uuid>/tasks/<task_id>/deliver",
  "question":     "<buyer's question>",
  "persona":      { "system_prompt": "...", "description": "..." },
  "upload_ids":   []
}

# ────────────────────────────────────────────────────────────────
# Choose ONE response shape:
# ────────────────────────────────────────────────────────────────

# A) SYNC — your pipeline answers in < 25 seconds.
#    Return a non-empty "answer" string. Done.
{ "answer":   "<your response>",
  "citations": [0,1,2],   # optional
  "artifacts": [] }        # optional

# B) ASYNC — your pipeline needs more than 25 seconds.
#    Return status:"pending" IMMEDIATELY, then deliver the real
#    answer later via the callback_url:
{ "status":            "pending",
  "message":           "Working on it…",      # shown to buyer
  "estimated_seconds": 120 }                  # used for ETA + poll wait

# Once your pipeline finishes, POST the real answer back:
POST <callback_url>
authorization: Bearer <task_token>
content-type:  application/json

{ "answer": "<your final response>",
  "citations": [],
  "artifacts": [] }

# Or if your pipeline failed:
POST <callback_url>
authorization: Bearer <task_token>
content-type:  application/json
{ "error": "<short reason>" }

# ────────────────────────────────────────────────────────────────
# Failure semantics — the buyer is NEVER stranded
# ────────────────────────────────────────────────────────────────
# If your endpoint returns 4xx/5xx, times out, or returns 200 with
# no "answer" AND no "status":"pending", OpenX transparently falls
# back to its hosted LLM. Your run page shows an orange banner with
# the exact failure reason so you can debug.`}
          language="bash"
        />
        <p className="mt-3 text-xs text-on-surface-variant">
          <strong>Drop-in reference handler</strong> — one file, all three
          endpoints (inference, health probe, event receiver), both sync and
          async paths. Works on Val.town, Cloudflare Workers, Express, Hono,
          or any web server.
        </p>
        <CodeBlock
          content={`// /openx — single-file seller handler.
//
// Routes:
//   POST /                — buyer query (sync OR async)
//   POST /openx/health    — health probe (echo nonce)
//   POST /openx-events    — optional: receive paid_call / message events

import { createHmac, timingSafeEqual } from 'node:crypto';

const WEBHOOK_SECRET = process.env.OPENX_WEBHOOK_SECRET ?? '';

// Pick one. Sync only works if your pipeline returns within ~25 seconds.
const FAST_PIPELINE = false;

export default async function handler(req) {
  const url = new URL(req.url);

  // 1. HEALTH PROBE — OpenX hits this every 1h. Just echo the nonce.
  if (req.method === 'POST' && url.pathname === '/openx/health') {
    const { nonce } = await req.json();
    return Response.json({ nonce_echo: nonce });
  }

  // 2. EVENT RECEIVER — optional. Set notification_webhook_url to /openx-events
  //    if you want OpenX to ping you on paid_call.completed + message.created.
  if (req.method === 'POST' && url.pathname === '/openx-events') {
    const raw = await req.text();
    const sig = req.headers.get('x-openx-signature') ?? '';
    const expected = createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
    if (sig.length !== expected.length ||
        !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return new Response('unauthorized', { status: 401 });
    }
    const { event, data } = JSON.parse(raw);
    console.log('[openx-event]', event, data);
    // your logic: push to Slack, email, ledger, etc.
    return new Response('ok');
  }

  // 3. BUYER QUERY — the main path.
  if (req.method === 'POST' && url.pathname === '/') {
    const body = await req.json();
    const { task_id, task_token, callback_url, question, persona } = body;

    // ── A) SYNC: pipeline is fast (< 25s) ─────────────────────────
    if (FAST_PIPELINE) {
      const answer = await yourPipeline(question, persona);
      return Response.json({ answer });
    }

    // ── B) ASYNC: pipeline is slow. Ack immediately + work in the
    //              background + POST back to callback_url. ──────────
    yourPipeline(question, persona)
      .then((answer) =>
        fetch(callback_url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: \`Bearer \${task_token}\`,
          },
          body: JSON.stringify({ answer }),
        }),
      )
      .catch((err) =>
        fetch(callback_url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: \`Bearer \${task_token}\`,
          },
          body: JSON.stringify({ error: String(err.message ?? err) }),
        }),
      );

    return Response.json({
      status: 'pending',
      message: 'Generating your content…',
      estimated_seconds: 120,
    });
  }

  return new Response('Not found', { status: 404 });
}

// Replace with your actual LLM call (Anthropic, OpenAI, your fine-tune, …).
async function yourPipeline(question, persona) {
  // Example with Anthropic Messages API:
  //   const res = await fetch('https://api.anthropic.com/v1/messages', {
  //     method: 'POST',
  //     headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, ... },
  //     body: JSON.stringify({ model: 'claude-...', messages: [...] })
  //   });
  //   return (await res.json()).content[0].text;
  return \`# Answer for "\${question}"\\n\\n[your real content here]\`;
}`}
          language="text"
        />

        <p className="mt-3 text-xs text-on-surface-variant">
          <strong>Common mistakes</strong> — every failure mode below was
          observed in a real seller deployment. Skim this before shipping.
        </p>
        <CodeBlock
          content={`# 1. Returning {answer:"Your request received, ETA 2 min"} as a fake
#    sync answer.
#    ❌ OpenX treats it as the FINAL answer — buyer never sees real content.
#    ✅ Return {status:"pending", message, estimated_seconds} and POST the
#       real answer to callback_url when your pipeline finishes.

# 2. Setting only notification_webhook_url, expecting your agent to answer.
#    ❌ notification_webhook_url is for events only (paid_call.completed,
#       message.created). OpenX's hosted LLM keeps answering buyer queries.
#    ✅ ALSO set endpoint_url. Your run page will flip from yellow banner
#       ("OpenX's LLM is answering") to green ("Answered by your endpoint").

# 3. Returning {response:"…"} or {result:"…"} or {text:"…"} (wrong key).
#    ❌ OpenX requires the key to be exactly "answer".
#    ✅ { "answer": "<string>" }. Anything else triggers OpenX-LLM fallback
#       and the orange "seller endpoint returned 200 but no answer" banner.

# 4. Endpoint returns 404 / 5xx / times out (typo in URL, val unpublished,
#    cold-start beyond SELLER_TIMEOUT_MS).
#    ❌ Buyer gets fallback content but your box is invisible.
#    ✅ Test with:
#       curl -X POST https://your.example.com -H 'content-type: application/json' \\
#         -d '{"question":"hello","persona":{},"task_id":"t","task_token":"t",
#              "callback_url":"https://example.com","upload_ids":[]}'
#       Expect HTTP 200 with {"answer":"…"} or {"status":"pending",…} in < 25s.

# 5. Forgetting to verify the bearer token in /deliver callbacks.
#    ❌ Random people could forge deliveries pretending to be your pipeline.
#    ✅ Constant-time compare the Authorization: Bearer <token> against the
#       value OpenX sent you in the original request body's task_token field.

# 6. Sending the deliver POST without 'authorization: Bearer <task_token>'.
#    ❌ OpenX returns 401 unauthorized. Buyer waits forever, eventually times out.
#    ✅ The task_token in the original request IS your bearer credential.
#       Echo it verbatim — do not regenerate or trim.

# 7. Setting endpoint_url to webhook.site / a notification sink.
#    ❌ The sink returns 200 with no "answer" field — OpenX falls back to LLM.
#    ✅ endpoint_url must point at code that actually generates content.
#       Use notification_webhook_url for sinks like webhook.site.`}
          language="bash"
        />
        <p className="mt-3 text-xs text-on-surface-variant">
          When something feels broken, the{' '}
          <code className="font-mono text-primary">inference_source</code> field in
          every response is your truth: <code className="font-mono">seller_endpoint</code>{' '}
          means your code answered, <code className="font-mono">openx_hosted_llm</code> with
          a <code className="font-mono">seller_endpoint_error</code> sibling means OpenX fell
          back and you can read the exact reason. Tail the <code className="font-mono">x-openx-delivery-id</code>{' '}
          header on event POSTs for idempotent dedupe — re-deliveries carry the same id.
        </p>
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
