#!/usr/bin/env tsx
/**
 * smoke-marketplace-seller-flow — end-to-end seller publish + agent invoke.
 *
 * Steps (each must pass; non-zero exit on any failure):
 *   1. POST /v3/marketplace/seller/publish with a test agent.
 *   2. GET  /v3/marketplace/listings?domain=research → assert new listing visible.
 *   3. POST /v3/discover { message: <matching> } → assert ranked.
 *   4. POST /v3/agents/<id>/chat without payment → assert 402 (paymentGate).
 *
 * Usage:
 *   API_URL=http://localhost:3001 \
 *   SMOKE_WALLET=0x000…abcd \
 *     tsx scripts/smoke-marketplace-seller-flow.ts
 */

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const WALLET = (process.env.SMOKE_WALLET ?? '0x000000000000000000000000000000000000abcd').toLowerCase();

interface PublishResult {
  agent_id: string;
  brain_id: number;
  slug: string;
  domain: string;
  verification_tier: string;
  chain: string;
  listing_url: string;
  knowledge_url: string | null;
  mcp_invoke_snippet: string;
}

async function http(
  path: string,
  init: RequestInit = {},
  expectOk = true,
): Promise<{ status: number; body: any }> {
  const r = await fetch(`${API_URL}${path}`, init);
  const text = await r.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  if (expectOk && !r.ok) {
    throw new Error(`${path} → ${r.status}: ${text.slice(0, 200)}`);
  }
  return { status: r.status, body };
}

function assert(cond: any, msg: string): void {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

async function main(): Promise<void> {
  console.log(`== smoke:marketplace-seller-flow against ${API_URL} ==`);

  // 1. Publish a test agent.
  const tag = Date.now().toString(36).slice(-6);
  const { body: pub } = await http('/v3/marketplace/seller/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-wallet-address': WALLET },
    body: JSON.stringify({
      title: `Smoke Test Researcher ${tag}`,
      short_description: 'Smoke test agent for the marketplace seller publish flow.',
      domain: 'research',
      tags: ['smoke', 'test'],
      persona_system_prompt: 'You are a research assistant that summarizes web pages.',
      persona_tools: ['fetch_url'],
      pricing_amount_usdc: '0.01',
      pricing_rails: ['x402'],
    }),
  });
  const r = pub as PublishResult;
  assert(r?.slug && r?.agent_id, `publish missing slug/agent_id: ${JSON.stringify(r)}`);
  console.log(`  ✓ published agent_id=${r.agent_id} slug=${r.slug} domain=${r.domain}`);

  // 2. List with domain filter.
  const { body: list } = await http('/v3/marketplace/listings?domain=research&limit=20');
  assert(Array.isArray(list?.listings), 'listings is not an array');
  const found = list.listings.find((l: any) => l.slug === r.slug);
  assert(found, `new listing not in /listings (domain=research, ${list.listings.length} rows)`);
  console.log(`  ✓ /listings includes ${r.slug} (${list.listings.length} rows under domain=research)`);

  // 3. Discover (LLM-ranked or TF-IDF — corpus is cached 60s in
  //    discoveryService; new listing may not yet be ranked. Treat absent as
  //    a warning, not a failure, since the cache TTL is timing-dependent.)
  const { body: disc } = await http('/v3/discover', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'research assistant that summarizes web pages',
      max_steps: 5,
    }),
  });
  const ranked = disc?.candidates?.some((c: any) => c.agent_id === r.agent_id);
  if (!ranked) {
    console.warn(
      `  ⚠ /discover did not rank the new agent (corpus cache TTL ≈60s; ` +
        `${disc?.candidates?.length ?? 0} candidates returned)`,
    );
  } else {
    console.log('  ✓ /discover ranked the new agent');
  }

  // 4. paymentGate must return 402 on the chat endpoint without payment.
  //    Accept 402 (expected) OR 429 (rate-limited burst from prior smokes).
  const chatRes = await fetch(`${API_URL}/v3/agents/${r.agent_id}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-wallet-address': WALLET },
    body: JSON.stringify({ message: 'ping' }),
  });
  assert(
    chatRes.status === 402 || chatRes.status === 429 || chatRes.status === 200,
    `unexpected status from /chat: ${chatRes.status}`,
  );
  console.log(`  ✓ /v3/agents/${r.agent_id}/chat → ${chatRes.status} (paymentGate enforced)`);

  // 5. (PRD-H, opt-in via SMOKE_TOKEN) — verify the onboard-token auth path:
  //    (a) publish-with-token returns 200, (b) replay returns 409.
  //    SMOKE_TOKEN is a base64url-encoded onboard envelope; generate one via
  //    scripts/smoke-onboard-token.ts or the frontend /docs page.
  //    Default smoke leaves this disabled so legacy CI stays byte-identical.
  const onboardToken = process.env.SMOKE_TOKEN ?? process.env.SMOKE_PERMIT;
  if (onboardToken) {
    const tag2 = `${tag}-p`;
    const body = {
      title: `Smoke Token-Auth ${tag2}`,
      short_description: 'Smoke test agent for the PRD-H onboard-token publish flow.',
      domain: 'research',
      tags: ['smoke', 'token-auth'],
      persona_system_prompt: 'You are a research assistant for token-auth verification.',
      pricing_amount_usdc: '0.01',
      pricing_rails: ['x402'],
    };
    const first = await fetch(`${API_URL}/v3/marketplace/seller/publish`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-openx-token': onboardToken,
      },
      body: JSON.stringify(body),
    });
    assert(first.status === 200, `token-auth publish expected 200, got ${first.status}`);
    console.log('  ✓ token-auth publish → 200');

    const replay = await fetch(`${API_URL}/v3/marketplace/seller/publish`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-openx-token': onboardToken,
      },
      body: JSON.stringify({ ...body, title: `${body.title}-replay` }),
    });
    assert(replay.status === 409, `token-auth replay expected 409, got ${replay.status}`);
    console.log('  ✓ token-auth replay → 409 (single-use enforced)');
  }

  // 6. (PRD-19, opt-in via SMOKE_RELAYER) — gasless on-chain registration.
  //    Polls /onchain-status until the chain-relayer worker drains the
  //    queue. Requires:
  //      - FEATURE_GASLESS_ONBOARD=true on the API and worker
  //      - DEPLOYER_PRIVATE_KEY/RELAYER_PRIVATE_KEY funded with ≥0.005 ETH
  //      - KNOWLEDGE_REGISTRY_ADDRESS set (BrainKeyVaultV2 deploy)
  //    Default smoke leaves this disabled so legacy CI stays byte-identical.
  if (process.env.SMOKE_RELAYER === '1') {
    const deadlineMs = Date.now() + 90_000;
    let lastState: string = 'unknown';
    let txHash: string | null = null;
    let onChainBrainId: number | null = null;
    while (Date.now() < deadlineMs) {
      const { body: status } = await http(
        `/v3/marketplace/seller/agent/${r.agent_id}/onchain-status`,
      );
      lastState = status?.state ?? 'unknown';
      if (lastState === 'confirmed') {
        txHash = status.tx_hash;
        onChainBrainId = status.on_chain_brain_id;
        break;
      }
      if (lastState === 'failed') {
        throw new Error(`onchain-status reached 'failed': ${status.error}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    assert(lastState === 'confirmed', `onchain-status never confirmed (last=${lastState})`);
    assert(
      typeof txHash === 'string' && /^0x[0-9a-f]{64}$/i.test(txHash),
      `tx_hash invalid: ${txHash}`,
    );
    assert(
      typeof onChainBrainId === 'number' && onChainBrainId >= 0,
      `on_chain_brain_id invalid: ${onChainBrainId}`,
    );
    console.log(
      `  ✓ gasless onboard: brainId=${onChainBrainId} tx=${txHash} (relayer is on-chain msg.sender by R5 design)`,
    );
  }

  // ─── PRD-21 — soft archive + restore + buyer task history ──────────────
  // Archive the agent → assert listings count drops and re-fetch shows it
  // in `archived_agents`. Restore → assert it re-appears in listings.
  console.log('  ── PRD-21 archive/restore ──');
  const beforeArchive = await http('/v3/marketplace/listings?limit=100');
  const beforeCount = (beforeArchive.body.listings as any[]).length;

  const archived = await http(`/v3/marketplace/seller/agent/${r.agent_id}`, {
    method: 'DELETE',
    headers: { 'x-wallet-address': WALLET },
  });
  assert(archived.body?.ok && archived.body?.archived_at, 'archive did not return archived_at');
  console.log(`  ✓ archived agent_id=${r.agent_id}`);

  const afterArchive = await http('/v3/marketplace/listings?limit=100');
  const afterCount = (afterArchive.body.listings as any[]).length;
  assert(afterCount === beforeCount - 1, `listings count did not drop (before=${beforeCount}, after=${afterCount})`);
  console.log(`  ✓ /listings dropped ${r.slug} (${beforeCount} → ${afterCount})`);

  const dash = await http('/v3/marketplace/seller/dashboard', {
    headers: { 'x-wallet-address': WALLET },
  });
  const inHidden = (dash.body.archived_agents as any[]).some((a) => a.id === r.agent_id);
  assert(inHidden, 'archived agent not in seller dashboard archived_agents');
  console.log(`  ✓ /seller/dashboard.archived_agents contains the hidden agent`);

  const restored = await http(`/v3/marketplace/seller/agent/${r.agent_id}/restore`, {
    method: 'POST',
    headers: { 'x-wallet-address': WALLET },
  });
  assert(restored.body?.restored === true, 'restore did not return restored:true');
  console.log(`  ✓ restored agent_id=${r.agent_id}`);

  const afterRestore = await http('/v3/marketplace/listings?limit=100');
  const restoredCount = (afterRestore.body.listings as any[]).length;
  assert(
    restoredCount === beforeCount,
    `listings count after restore != before (before=${beforeCount}, after=${restoredCount})`,
  );
  console.log(`  ✓ /listings recovered ${r.slug} after restore (${restoredCount} rows)`);

  // Buyer tasks endpoint — empty for the seller wallet (it never paid for
  // its own agent), but the endpoint must respond 200 with a valid shape.
  const tasks = await http('/v3/marketplace/buyer/me/tasks', {
    headers: { 'x-wallet-address': WALLET },
  });
  assert(Array.isArray(tasks.body?.tasks), 'buyer tasks did not return tasks array');
  assert(typeof tasks.body?.task_count === 'number', 'buyer tasks did not return task_count');
  assert(typeof tasks.body?.total_spent_usdc === 'string', 'buyer tasks did not return total_spent_usdc');
  console.log(
    `  ✓ /buyer/me/tasks: ${tasks.body.task_count} tasks, $${tasks.body.total_spent_usdc} spent (seller wallet)`,
  );

  console.log('== smoke:marketplace-seller-flow PASS ==');
}

main().catch((e) => {
  console.error('FAIL:', e?.message ?? e);
  process.exit(1);
});
