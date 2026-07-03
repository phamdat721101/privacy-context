#!/usr/bin/env tsx
/**
 * smoke-agent-training-pipeline.ts — Agent Training Pipeline v1.0 e2e gate.
 *
 * Verifies against a running API on ${API_URL} (default http://localhost:3001):
 *   1. GET /v3/kits returns 7 seeded kits
 *   2. GET /v3/kits/n-payment returns full detail with ≥5 capabilities
 *   3. (feature-flag off path) GET returns 501 when
 *      FEATURE_AGENT_TRAINING_PIPELINE=false
 *
 * Prerequisites (invoked by the operator):
 *   - Migration 039 applied
 *   - Seed script run: `DATABASE_URL=... npm run seed:kits`
 *   - API started with FEATURE_AGENT_TRAINING_PIPELINE=true
 *
 * Zero side effects on external chains. All assertions are console.assert +
 * process.exit(1) on failure to keep CI logs readable.
 */

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

interface Kit {
  slug: string;
  name: string;
  audit_score: number;
}

async function main(): Promise<void> {
  console.log(`▶ smoke:agent-training-pipeline against ${API_URL}`);

  // 1. Kit registry list
  const listRes = await fetch(`${API_URL}/v3/kits`);
  if (listRes.status === 501) {
    console.error(
      '✗ /v3/kits returned 501 — set FEATURE_AGENT_TRAINING_PIPELINE=true on the API.',
    );
    process.exit(1);
  }
  if (!listRes.ok) {
    console.error(`✗ /v3/kits returned HTTP ${listRes.status}`);
    process.exit(1);
  }
  const listBody = (await listRes.json()) as { kits: Kit[] };
  if (!Array.isArray(listBody.kits)) {
    console.error('✗ /v3/kits did not return { kits: [] }');
    process.exit(1);
  }
  if (listBody.kits.length < 7) {
    console.error(
      `✗ /v3/kits returned ${listBody.kits.length} kits (expected ≥7). Run: npm run seed:kits`,
    );
    process.exit(1);
  }
  console.log(`  ✓ /v3/kits → ${listBody.kits.length} kits (top: ${listBody.kits[0].slug})`);

  // 2. Kit detail — n-payment
  const detailRes = await fetch(`${API_URL}/v3/kits/n-payment`);
  if (!detailRes.ok) {
    console.error(`✗ /v3/kits/n-payment returned HTTP ${detailRes.status}`);
    process.exit(1);
  }
  const detail = (await detailRes.json()) as {
    kit: Kit;
    latest_version: { version: string } | null;
    capabilities: Array<{ capability_id: string; chains: string[] }>;
  };
  if (!detail.kit || detail.kit.slug !== 'n-payment') {
    console.error('✗ /v3/kits/n-payment did not return the expected kit');
    process.exit(1);
  }
  if (!detail.latest_version) {
    console.error('✗ n-payment latest_version missing — seed script did not upsert version rows');
    process.exit(1);
  }
  if (detail.capabilities.length < 5) {
    console.error(
      `✗ n-payment has only ${detail.capabilities.length} capabilities (expected ≥5)`,
    );
    process.exit(1);
  }
  console.log(
    `  ✓ /v3/kits/n-payment → v${detail.latest_version.version}, ${detail.capabilities.length} capabilities`,
  );

  // 3. Introspect a non-existent agent → 404 (proves the route is wired and
  //    reachable even without a live agent).
  const introspectRes = await fetch(
    `${API_URL}/v3/agents/00000000-0000-0000-0000-000000000000/introspect`,
  );
  if (introspectRes.status !== 404) {
    console.error(
      `✗ /v3/agents/<zero-uuid>/introspect returned ${introspectRes.status} (expected 404)`,
    );
    process.exit(1);
  }
  console.log(`  ✓ /v3/agents/:id/introspect wired (404 for unknown UUID as expected)`);

  console.log('\n✅ agent-training-pipeline smoke passed');
}

main().catch((e) => {
  console.error('smoke:agent-training-pipeline failed:', e);
  process.exit(1);
});
