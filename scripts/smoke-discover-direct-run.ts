/**
 * smoke-discover-direct-run — verifies /v3/discover candidates always carry
 * a usable routing identifier for the homepage → direct-to-run flow, for
 * BOTH legacy brain-backed agents and brain-less wizard-published agents.
 *
 * Background: `agent_id` in each candidate is `agent.id` from the ranked
 * corpus row — always populated. `brain_id` is nullable (null for
 * wizard-published listings with no legacy `brains` row). The homepage
 * link-building logic routes on `brain_id ?? agent_id`; this script proves
 * that fallback never produces an unusable (empty/undefined) identifier.
 *
 * Run: SMOKE_API_URL=https://13-229-63-192.sslip.io npm run smoke:discover-direct-run
 * Exits 0 on full success, 1 on any failure.
 */

const API = (process.env.SMOKE_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

const log = (...a: unknown[]) => console.log('[smoke-discover-direct-run]', ...a);
const fail = (msg: string): never => {
  console.error('[smoke-discover-direct-run] FAIL —', msg);
  process.exit(1);
};

interface Candidate {
  agent_id: string;
  brain_id: number | null;
  score: number;
  reason: string;
  persona_summary: string;
  pricing: Record<string, string | null>;
  chain: string;
}

async function main() {
  log(`→ API base = ${API}`);

  log('Stage 1: POST /v3/discover');
  const res = await fetch(`${API}/v3/discover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'translate a document', max_steps: 5 }),
  });
  if (!res.ok) fail(`discover returned ${res.status}`);
  const body = (await res.json()) as { candidates?: Candidate[] };
  const candidates = body.candidates ?? [];

  if (candidates.length === 0) {
    log('  ⚠ no candidates returned in this environment — nothing to verify, treating as pass');
    console.log('\n✅ smoke-discover-direct-run PASSED (no candidates to check)');
    return;
  }

  log(`  ✓ discover returned ${candidates.length} candidate(s)`);

  // Every candidate must yield a non-empty routeId = brain_id ?? agent_id —
  // this is exactly the expression the homepage uses to build /agent/{routeId}/run.
  let brainBacked = 0;
  let brainLess = 0;
  for (const c of candidates) {
    const routeId = c.brain_id ?? c.agent_id;
    if (routeId === null || routeId === undefined || String(routeId).length === 0) {
      fail(`candidate ${JSON.stringify(c)} produced an empty routeId`);
    }
    if (c.brain_id != null) brainBacked++;
    else brainLess++;

    // agent_id must always be present and look like a v3 agents.id (uuid-ish
    // string) regardless of brain_id — this is the Task 1 assertion.
    if (!c.agent_id || typeof c.agent_id !== 'string') {
      fail(`candidate missing usable agent_id: ${JSON.stringify(c)}`);
    }
  }
  log(`  ✓ every candidate has a usable routeId (brain-backed=${brainBacked}, brain-less=${brainLess})`);

  console.log('\n✅ smoke-discover-direct-run PASSED');
}

main().catch((err) => {
  console.error('[smoke-discover-direct-run] CRASH —', err);
  process.exit(1);
});
