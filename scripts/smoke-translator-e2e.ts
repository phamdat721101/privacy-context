/**
 * smoke-translator-e2e.ts — proves the full buyer journey end-to-end.
 *
 * Step 1. POST /v3/discover { message: "translate NDA to vietnamese" }
 *         → translator agent ranks in top-3.
 *
 * Step 2. GET /api/v1/translator-en-vi (no payment)
 *         → 402 with x402 challenge envelope.
 *
 * Step 2 only — actually paying requires a wallet with USDC + ETH gas, which
 * is out of scope for an offline smoke. The 402 envelope shape is the
 * paywall contract; if it's right, the production wallet flow will settle.
 *
 * Usage:
 *   API_URL=http://localhost:3001 npx tsx scripts/smoke-translator-e2e.ts
 *   API_URL=https://13-229-63-192.sslip.io npx tsx scripts/smoke-translator-e2e.ts
 */

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

async function step1_discoveryRanksTranslator() {
  const r = await fetch(`${API_URL}/v3/discover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'translate this NDA to vietnamese' }),
  });
  if (!r.ok) throw new Error(`discover failed: ${r.status}`);
  const j: any = await r.json();
  const top3Slugs = (j.candidates ?? []).slice(0, 3).map((c: any) => c.slug);
  if (!top3Slugs.includes('translator-en-vi')) {
    throw new Error(
      `translator-en-vi not in top-3 candidates: ${JSON.stringify(top3Slugs)}`,
    );
  }
  console.log('  ✓ /v3/discover ranks translator-en-vi in top-3');
}

async function step2_paywallChallenge() {
  const r = await fetch(`${API_URL}/api/v1/translator-en-vi`);
  if (r.status !== 402) {
    throw new Error(`expected 402, got ${r.status}`);
  }
  const j: any = await r.json().catch(() => ({}));
  if (!j.accepts || !Array.isArray(j.accepts)) {
    throw new Error('402 body missing { accepts: [...] }');
  }
  console.log(`  ✓ /api/v1/translator-en-vi returns 402 with ${j.accepts.length} payment option(s)`);
}

async function main() {
  console.log(`smoke-translator-e2e against ${API_URL}`);
  await step1_discoveryRanksTranslator();
  await step2_paywallChallenge();
  console.log('all checks passed');
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
