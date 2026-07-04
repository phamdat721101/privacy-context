#!/usr/bin/env tsx
/**
 * smoke-studio-portal — validates PRD-V seller portal endpoints.
 *
 * Section A (module-level):
 *   • Master flag cascade — FEATURE_OPENX_V2=false forces
 *     FEATURE_SELLER_PORTAL_V1 off even when set to 'true'.
 *
 * Section B (end-to-end, requires API_URL + WALLET):
 *   • GET /v3/studio/agents           → owner list (200 or 501 flag-off)
 *   • GET /v3/studio/agents/:id       → 200 or 404 for owner
 *   • GET /v3/studio/agents/:id/tasks → 200 with pagination shape
 *   • GET /v3/studio/agents/:id/dream/runs   → 200
 *   • GET /v3/studio/agents/:id/revenue      → 200
 *
 * Usage:
 *   tsx scripts/smoke-studio-portal.ts                     # Section A only
 *   API_URL=http://localhost:3001 WALLET=0x… tsx …         # + Section B
 *   FEATURE_SELLER_PORTAL_V1=true npm run api:dev &        # to enable Section B
 *
 * WCAG-AA + Lighthouse validation happen manually against the running
 * frontend (not automatable in a bare tsx smoke). See PRD-V ship-gate
 * criteria 1 + 6.
 */

/* eslint-disable no-console */

import { isOpenxV2SubFlagOn } from '../packages/api/src/lib';

let passed = 0;
let failed = 0;

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e: any) {
    console.error(`✗ ${name}: ${e?.message ?? e}`);
    if (process.env.DEBUG) console.error(e?.stack);
    failed++;
  }
}

const assert = (cond: unknown, msg: string): void => {
  if (!cond) throw new Error(msg);
};

// ─── Section A — module-level ─────────────────────────────────────────────

async function sectionA(): Promise<void> {
  console.log('\n─── Section A: PRD-V master-flag cascade ───\n');

  const saveMaster = process.env.FEATURE_OPENX_V2;
  const saveV1 = process.env.FEATURE_SELLER_PORTAL_V1;

  await step('cascade: v1=true, master unset → ON', async () => {
    delete process.env.FEATURE_OPENX_V2;
    process.env.FEATURE_SELLER_PORTAL_V1 = 'true';
    assert(isOpenxV2SubFlagOn('FEATURE_SELLER_PORTAL_V1'), 'expected ON');
  });

  await step('cascade: v1=true, master=false → OFF (rollback contract)', async () => {
    process.env.FEATURE_OPENX_V2 = 'false';
    process.env.FEATURE_SELLER_PORTAL_V1 = 'true';
    assert(!isOpenxV2SubFlagOn('FEATURE_SELLER_PORTAL_V1'), 'expected OFF (master overrides)');
  });

  await step('cascade: v1 unset → OFF', async () => {
    delete process.env.FEATURE_OPENX_V2;
    delete process.env.FEATURE_SELLER_PORTAL_V1;
    assert(!isOpenxV2SubFlagOn('FEATURE_SELLER_PORTAL_V1'), 'expected OFF');
  });

  if (saveMaster === undefined) delete process.env.FEATURE_OPENX_V2;
  else process.env.FEATURE_OPENX_V2 = saveMaster;
  if (saveV1 === undefined) delete process.env.FEATURE_SELLER_PORTAL_V1;
  else process.env.FEATURE_SELLER_PORTAL_V1 = saveV1;
}

// ─── Section B — E2E vs a running API ─────────────────────────────────────

async function sectionB(apiUrl: string): Promise<void> {
  console.log(`\n─── Section B: E2E vs ${apiUrl} ───\n`);

  const wallet = process.env.WALLET ?? '0x000000000000000000000000000000000000dEaD';
  const headers: Record<string, string> = {
    'x-wallet-address': wallet,
    accept: 'application/json',
  };

  async function getJson(path: string): Promise<{ status: number; json: any }> {
    const r = await fetch(`${apiUrl}${path}`, { headers });
    const text = await r.text();
    let json: any = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { error: text.slice(0, 200) };
      }
    }
    return { status: r.status, json };
  }

  let firstAgentId: string | null = null;

  await step('GET /v3/studio/agents → 200 or 501', async () => {
    const { status, json } = await getJson('/v3/studio/agents');
    if (status === 501) {
      console.warn('  (skipping: FEATURE_SELLER_PORTAL_V1=false — enable to run full B)');
      return;
    }
    assert(status === 200, `expected 200; got ${status} ${JSON.stringify(json)}`);
    assert(Array.isArray(json.agents), 'agents array present');
    assert(json.aggregate && typeof json.aggregate.total_hires_mtd === 'number', 'aggregate shape');
    if (json.agents.length > 0) firstAgentId = json.agents[0].id;
  });

  if (firstAgentId) {
    await step(`GET /v3/studio/agents/${firstAgentId} → 200 shape`, async () => {
      const { status, json } = await getJson(`/v3/studio/agents/${firstAgentId}`);
      assert(status === 200, `expected 200; got ${status} ${JSON.stringify(json)}`);
      assert(typeof json.training_stage === 'number', 'training_stage present');
      assert(json.setup_checklist && Array.isArray(json.setup_checklist.steps), 'checklist shape');
      assert(json.kpis && typeof json.kpis.hires_mtd === 'number', 'kpis shape');
    });

    await step(`GET /v3/studio/agents/${firstAgentId}/tasks?role=all → 200 shape`, async () => {
      const { status, json } = await getJson(
        `/v3/studio/agents/${firstAgentId}/tasks?role=all&limit=20&offset=0`,
      );
      assert(status === 200, `expected 200; got ${status}`);
      assert(Array.isArray(json.tasks), 'tasks array');
      assert(typeof json.total === 'number', 'total present');
    });

    await step(`GET /v3/studio/agents/${firstAgentId}/dream/runs → 200 shape`, async () => {
      const { status, json } = await getJson(`/v3/studio/agents/${firstAgentId}/dream/runs`);
      assert(status === 200, `expected 200; got ${status}`);
      assert(Array.isArray(json.runs), 'runs array');
    });

    await step(`GET /v3/studio/agents/${firstAgentId}/revenue → 200 shape`, async () => {
      const { status, json } = await getJson(`/v3/studio/agents/${firstAgentId}/revenue`);
      assert(status === 200, `expected 200; got ${status}`);
      assert(typeof json.total_earned_usdc_mtd === 'number', 'mtd present');
      assert(json.by_source && typeof json.by_source.primary_hires_usdc === 'number', 'by_source shape');
    });
  }
}

// ─── main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await sectionA();

  const apiUrl = process.env.API_URL;
  if (apiUrl) {
    await sectionB(apiUrl);
  } else {
    console.log('\n(skipping Section B — set API_URL to run end-to-end tests)');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('smoke-studio-portal:fatal', e);
  process.exit(2);
});
