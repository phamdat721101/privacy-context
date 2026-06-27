/**
 * smoke-concierge-onboard — full PRD-1 E2E.
 *
 * Run: SMOKE_API_URL=https://13-229-63-192.sslip.io \
 *      FEATURE_PUBLIC_AGENT_ONBOARD=true \
 *      npm run smoke:concierge-onboard
 *
 * Exits 0 on full success, 1 on any failure.
 */

const API = (process.env.SMOKE_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const TEST_PROMPT =
  'My agent translates English to Vietnamese with native-speaker quality, ' +
  'priced at 0.05 USDC per query. It is hosted at https://example.com/api. ' +
  'Operator email is smoke@openx.dev.';

const log = (...a: unknown[]) => console.log('[smoke-concierge]', ...a);
const fail = (msg: string): never => {
  console.error('[smoke-concierge] FAIL —', msg);
  process.exit(1);
};

async function main() {
  log(`→ API base = ${API}`);

  // ── Stage 1: POST /v3/concierge/onboard ────────────────────────────────
  log('Stage 1: POST /v3/concierge/onboard');
  const onboardRes = await fetch(`${API}/v3/concierge/onboard`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: TEST_PROMPT + ' Run id: ' + Date.now(),
      operator_email: 'smoke@openx.dev',
    }),
  });
  const onboardBody = (await onboardRes.json()) as any;
  if (onboardRes.status !== 200 || onboardBody.status !== 'live') {
    fail(`onboard returned ${onboardRes.status}: ${JSON.stringify(onboardBody).slice(0, 300)}`);
  }
  const { agent_id, slug, agent_url, paywall_url } = onboardBody;
  log(`  ✓ live: agent_id=${agent_id} slug=${slug}`);

  // ── Stage 2: GET /v3/marketplace/listings?kind=public ──────────────────
  log('Stage 2: GET /v3/marketplace/listings?kind=public');
  const listRes = await fetch(`${API}/v3/marketplace/listings?kind=public&limit=100`);
  const listBody = (await listRes.json()) as { listings?: Array<{ id: string }> };
  const found = listBody.listings?.some((a) => a.id === agent_id);
  if (!found) fail(`agent ${agent_id} not in marketplace listings`);
  log('  ✓ agent appears in marketplace listings');

  // ── Stage 3: free-demo /v3/agents/:id/try ──────────────────────────────
  log('Stage 3: POST /v3/agents/:id/try (free demo)');
  const tryRes = await fetch(`${API}/v3/agents/${agent_id}/try`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'Hello world' }),
  });
  if (!tryRes.ok) {
    // Non-fatal when the seller endpoint is unreachable in smoke env.
    log(`  ⚠ try returned ${tryRes.status} (seller endpoint may not be live in smoke env)`);
  } else {
    log('  ✓ free demo call returned 200');
  }

  // ── Stage 4: /api/v1/<slug>/.well-known/agent.json ─────────────────────
  log('Stage 4: GET /api/v1/<slug>/.well-known/agent.json');
  const cardRes = await fetch(`${API}/api/v1/${slug}/.well-known/agent.json`);
  if (!cardRes.ok) fail(`agent.json returned ${cardRes.status}`);
  const card = (await cardRes.json()) as { name?: string };
  if (!card.name) fail('agent.json missing name field');
  log(`  ✓ agent.json served (name=${card.name})`);

  // ── Stage 5: 402 challenge on /api/v1/<slug> ────────────────────────────
  log('Stage 5: GET /api/v1/<slug>  (expect 402)');
  const paywallRes = await fetch(paywall_url);
  if (paywallRes.status !== 402) fail(`expected 402, got ${paywallRes.status}`);
  log('  ✓ paywall returns 402');

  console.log('\n✅ smoke-concierge-onboard PASSED');
  console.log(`   agent_url:   ${agent_url}`);
  console.log(`   paywall_url: ${paywall_url}`);
}

main().catch((err) => {
  console.error('[smoke-concierge] CRASH —', err);
  process.exit(1);
});
