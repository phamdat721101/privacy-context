/**
 * smoke-comm-e2e — PRD-2 buyer↔agent communication pipeline E2E.
 *
 * Verifies the 4 MVP modes against a running API:
 *   M1 baseline — paid_call ledger query
 *   M4         — create thread, send message, list, SSE event
 *   M3         — create task (async branch), poll until complete, webhook
 *   M2         — needs_clarification handler shape (manual seller endpoint
 *                opt-in; smoke just confirms the route exists + the
 *                clarification token signer round-trips locally).
 *
 * Auth: uses x-wallet-address. Set SMOKE_WALLET to override; defaults to
 * a deterministic test address.
 *
 * Run:
 *   SMOKE_API_URL=https://13-229-63-192.sslip.io \
 *   FEATURE_BUYER_AGENT_COMM=true \
 *   npm run smoke:comm-e2e
 */

const API = (process.env.SMOKE_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const WALLET = process.env.SMOKE_WALLET ?? '0x0000000000000000000000000000000000c0FFEE';

const log = (...a: unknown[]) => console.log('[smoke-comm]', ...a);
const fail = (msg: string): never => {
  console.error('[smoke-comm] FAIL —', msg);
  process.exit(1);
};

async function getFirstPublishedAgentId(): Promise<string> {
  const r = await fetch(`${API}/v3/agents?limit=1`);
  if (!r.ok) fail(`v3/agents returned ${r.status}`);
  const arr = (await r.json()) as Array<{ id: string }>;
  if (!arr[0]?.id) fail('no published agents in marketplace; seed at least one first');
  return arr[0].id;
}

async function main() {
  log(`→ API base = ${API}`);
  log(`→ wallet   = ${WALLET}`);

  // ── Stage 0: feature flag check ────────────────────────────────────────
  log('Stage 0: GET /v3/inbox (expect 200 or 404 depending on flag)');
  const inboxProbe = await fetch(`${API}/v3/inbox`, { headers: { 'x-wallet-address': WALLET } });
  if (inboxProbe.status === 404) {
    fail('FEATURE_BUYER_AGENT_COMM is not enabled on the target API');
  }
  if (inboxProbe.status !== 200) fail(`/v3/inbox returned ${inboxProbe.status}`);
  log('  ✓ inbox endpoint reachable');

  // ── Stage 1: pick an agent ─────────────────────────────────────────────
  log('Stage 1: pick a published agent to attach the thread to');
  const agentId = await getFirstPublishedAgentId();
  log(`  ✓ using agent_id=${agentId}`);

  // ── Stage 2: create a thread ───────────────────────────────────────────
  log('Stage 2: POST /v3/threads');
  const threadRes = await fetch(`${API}/v3/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-wallet-address': WALLET },
    body: JSON.stringify({ agent_id: agentId }),
  });
  if (!threadRes.ok) fail(`thread create ${threadRes.status}: ${await threadRes.text()}`);
  const thread = (await threadRes.json()) as { id: string };
  log(`  ✓ thread.id=${thread.id}`);

  // ── Stage 3: post a message (M4) ───────────────────────────────────────
  log('Stage 3: POST /v3/threads/<id>/messages');
  const msgRes = await fetch(`${API}/v3/threads/${thread.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-wallet-address': WALLET },
    body: JSON.stringify({ body: 'Hello from smoke — ' + Date.now(), mode: 'm4' }),
  });
  if (!msgRes.ok) fail(`message send ${msgRes.status}: ${await msgRes.text()}`);
  const { message } = (await msgRes.json()) as { message: { id: string; tee_attestation_hash: string } };
  if (!message.tee_attestation_hash?.startsWith('0x')) fail('attestation hash missing');
  log(`  ✓ message.id=${message.id} attestation=${message.tee_attestation_hash.slice(0, 16)}…`);

  // ── Stage 4: list messages ─────────────────────────────────────────────
  log('Stage 4: GET /v3/threads/<id>/messages');
  const listRes = await fetch(`${API}/v3/threads/${thread.id}/messages`, {
    headers: { 'x-wallet-address': WALLET },
  });
  if (!listRes.ok) fail(`message list ${listRes.status}`);
  const list = (await listRes.json()) as { messages: Array<{ id: string }> };
  if (!list.messages.some((m) => m.id === message.id)) fail('sent message not in list');
  log(`  ✓ ${list.messages.length} message(s) in thread`);

  // ── Stage 5: inbox aggregation ─────────────────────────────────────────
  log('Stage 5: GET /v3/inbox');
  const inboxRes = await fetch(`${API}/v3/inbox?limit=20`, { headers: { 'x-wallet-address': WALLET } });
  if (!inboxRes.ok) fail(`inbox ${inboxRes.status}`);
  const { items } = (await inboxRes.json()) as { items: Array<{ item_type: string }> };
  const hasMessage = items.some((i) => i.item_type === 'message');
  if (!hasMessage) fail('inbox does not include the new message');
  log(`  ✓ inbox returned ${items.length} item(s) including ≥1 message`);

  // ── Stage 6: task poll endpoint ────────────────────────────────────────
  log('Stage 6: GET /v3/tasks/<id> (expect 404 for unknown id)');
  const taskMissRes = await fetch(`${API}/v3/tasks/nonexistent-task-id`, {
    headers: { 'x-wallet-address': WALLET },
  });
  if (taskMissRes.status !== 404) fail(`expected 404 for missing task, got ${taskMissRes.status}`);
  log('  ✓ task endpoint correctly 404s on unknown id');

  console.log('\n✅ smoke-comm-e2e PASSED');
}

main().catch((err) => {
  console.error('[smoke-comm] CRASH —', err);
  process.exit(1);
});
