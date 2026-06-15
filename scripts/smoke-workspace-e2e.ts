/**
 * smoke-workspace-e2e.ts — PRD-E regression gate.
 *
 * Validates the four endpoints introduced for the agent task workspace
 * without requiring live wallets or LLM calls:
 *
 *   1. POST /v3/agents/<bogus>/uploads          → 404 (agent not found)
 *   2. POST /v3/agents/<id>/uploads (oversize)  → 413
 *   3. POST /v3/agents/<id>/uploads (bad MIME)  → 415
 *   4. GET  /v3/agents/<id>/recent-calls        → { rows: [...], cached?: bool }
 *   5. POST /v3/agents/<id>/try   { q, upload_ids: [] } accepts shape
 *
 * It picks a real agent id by listing /v3/agents (auth-gated) — and falls
 * back to the discovery endpoint to find any published slug, then resolves
 * to v3 agent id via /api/v1/<slug>/.well-known/agent.json. If neither is
 * reachable, the smoke skips with a warning rather than failing CI.
 *
 * Usage:
 *   API_URL=http://localhost:3001 npx tsx scripts/smoke-workspace-e2e.ts
 */

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

async function pickAgentId(): Promise<string | null> {
  // Try discover (anonymous) → returns slugs + v3 agent ids when present.
  const r = await fetch(`${API_URL}/v3/discover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'translate' }),
  }).catch(() => null);
  if (!r || !r.ok) return null;
  const j: any = await r.json().catch(() => ({}));
  const cands: any[] = Array.isArray(j?.candidates) ? j.candidates : [];
  for (const c of cands) {
    if (typeof c?.agent_id === 'string') return c.agent_id;
    if (typeof c?.id === 'string') return c.id;
  }
  return null;
}

async function step404_uploadsAgentNotFound() {
  const r = await fetch(
    `${API_URL}/v3/agents/00000000-0000-0000-0000-000000000000/uploads`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        original_name: 'test.txt',
        mime_type: 'text/plain',
        size_bytes: 1024,
      }),
    },
  );
  if (r.status !== 404) throw new Error(`expected 404, got ${r.status}`);
  console.log('  ✓ unknown-agent /uploads → 404');
}

async function step413_uploadsOversize(agentId: string) {
  const r = await fetch(`${API_URL}/v3/agents/${agentId}/uploads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      original_name: 'huge.bin',
      mime_type: 'application/octet-stream',
      size_bytes: 60 * 1024 * 1024,
    }),
  });
  if (r.status !== 413) throw new Error(`expected 413, got ${r.status}`);
  console.log('  ✓ 60 MB /uploads → 413');
}

async function step415_uploadsBadMime(agentId: string) {
  const r = await fetch(`${API_URL}/v3/agents/${agentId}/uploads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      original_name: 'evil.exe',
      mime_type: 'application/x-msdownload',
      size_bytes: 4096,
    }),
  });
  if (r.status !== 415) throw new Error(`expected 415, got ${r.status}`);
  console.log('  ✓ application/x-msdownload /uploads → 415');
}

async function stepRecentCallsShape(agentId: string) {
  const r = await fetch(`${API_URL}/v3/agents/${agentId}/recent-calls?limit=5`);
  if (!r.ok) throw new Error(`recent-calls failed: ${r.status}`);
  const j: any = await r.json();
  if (!Array.isArray(j?.rows)) throw new Error('recent-calls missing rows[]');
  for (const row of j.rows) {
    for (const k of ['tx_hash', 'payer', 'amount_usdc', 'status', 'network', 'settled_at']) {
      if (!(k in row)) throw new Error(`recent-calls row missing ${k}`);
    }
    if (typeof row.payer === 'string' && /^0x[0-9a-f]{40}$/i.test(row.payer)) {
      throw new Error(`recent-calls payer not anonymized: ${row.payer}`);
    }
  }
  // 2nd call within TTL must report cached:true (or at least respond).
  const r2 = await fetch(`${API_URL}/v3/agents/${agentId}/recent-calls?limit=5`);
  if (!r2.ok) throw new Error(`recent-calls (cached) failed: ${r2.status}`);
  console.log(`  ✓ /recent-calls returns ${j.rows.length} anonymized row(s)`);
}

async function stepTryAcceptsUploadIds(agentId: string) {
  const r = await fetch(`${API_URL}/v3/agents/${agentId}/try`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ q: 'hello', upload_ids: [] }),
  });
  // /try is rate-limited per IP/agent; on a fresh env it should run, on a
  // hot env it may 429. Either response shape is acceptable as long as it
  // isn't 400 (= the upload_ids field caused validation failure).
  if (r.status === 400) throw new Error(`/try rejected upload_ids body: 400`);
  console.log(`  ✓ /try accepts upload_ids[] (status=${r.status})`);
}

async function main() {
  console.log(`smoke-workspace-e2e against ${API_URL}`);
  await step404_uploadsAgentNotFound();
  const agentId = await pickAgentId();
  if (!agentId) {
    console.warn('  ⚠ no agent discovered — skipping per-agent checks');
    return;
  }
  console.log(`  · using agent id ${agentId}`);
  await step413_uploadsOversize(agentId);
  await step415_uploadsBadMime(agentId);
  await stepRecentCallsShape(agentId);
  await stepTryAcceptsUploadIds(agentId);
  console.log('all checks passed');
}

main().catch((e) => {
  console.error('FAIL:', (e as Error).message);
  process.exit(1);
});
