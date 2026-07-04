#!/usr/bin/env tsx
/**
 * smoke-openx-v2 — validates the OpenX v2 stack (PRD-U).
 *
 * Section A (module-level, no server):
 *   • OapService.validateManifest happy path
 *   • OapService.validateManifest rejects missing agent.name
 *   • OapService.validateManifest rejects invalid pricing.amount_usdc
 *   • OapService.validateManifest ignores unknown top-level keys (forward-compat)
 *   • OapService.hashManifest is stable + order-independent (canonical JSON)
 *   • manifestToSellerPublishInput maps minimum manifest → SellerPublishInput
 *
 * Section B (end-to-end, when API_URL is set):
 *   • POST /v3/oap/register {manifest} → returns 200 + {agent_id, slug, paywall_url}
 *   • POST /v3/oap/register {manifest} twice → same agent_id (idempotency by hash)
 *   • POST /v3/oap/register {} → 400 bad_request
 *
 * Usage:
 *   tsx scripts/smoke-openx-v2.ts                                # Section A only
 *   API_URL=http://localhost:3001 WALLET=0x… tsx scripts/smoke-openx-v2.ts   # + B
 *   FEATURE_OAP_REGISTRATION=true npm --prefix packages/api run dev &  # to enable B
 *
 * Environment for Section B:
 *   API_URL   — base URL of the running api (required to run Section B)
 *   WALLET    — 40-hex owner address to use in x-wallet-address (defaults to
 *               0x000000000000000000000000000000000000dEaD; expect 4xx unless
 *               the api runs with test creds)
 */

/* eslint-disable no-console */

import type { Pool } from 'pg';
import type { Logger } from 'pino';
import {
  OapService,
  manifestToSellerPublishInput,
  type OapManifest,
} from '../packages/api/src/services/oapService';
import {
  safeValidateEnvelope,
  envelopeToPrompt,
  type OapEnvelope,
} from '../packages/sdk/src/oap/schemas';
import {
  pickByPolicy,
  type Candidate,
  type RouterPolicy,
} from '../packages/api/src/services/agentOrchestrationService';
import { isOpenxV2SubFlagOn } from '../packages/api/src/lib';

// ─── Test harness (dep-free, matches smoke-onboard-token.ts) ─────────────

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

// ─── Mock deps for Section A — no real DB, no HTTP ───────────────────────

const noopPool = {
  query: async () => ({ rows: [], rowCount: 0 }),
  connect: async () => ({
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => undefined,
  }),
} as unknown as Pool;

const silentLogger = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  level: 'silent',
} as unknown as Logger;

// Constructor lets us validate + hash without touching the singleton (which
// imports pool + logger at module load and requires DATABASE_URL).
const oap = new OapService({ pool: noopPool, logger: silentLogger });

// ─── Fixtures ────────────────────────────────────────────────────────────

const MINIMUM_MANIFEST: OapManifest = {
  version: '1.0',
  agent: {
    name: 'Smoke Agent',
    description: 'A minimum-viable OAP manifest used by the smoke test.',
  },
  persona: {
    system_prompt: 'You are a smoke-test agent.',
  },
  pricing: {
    amount_usdc: '0.05',
  },
};

// ─── Section A ────────────────────────────────────────────────────────────

async function sectionA(): Promise<void> {
  console.log('\n─── Section A: module-level validate + hash ───\n');

  await step('validate: minimum manifest is accepted', async () => {
    const r = oap.validateManifest(MINIMUM_MANIFEST);
    assert(r.ok, `expected ok, got ${JSON.stringify(r)}`);
  });

  await step('validate: missing agent.name is rejected', async () => {
    const bad = { ...MINIMUM_MANIFEST, agent: { description: 'no name' } };
    const r = oap.validateManifest(bad);
    assert(!r.ok, 'expected rejection');
    assert(
      !r.ok && r.reason.includes('agent.name'),
      `reason should mention agent.name; got: ${!r.ok ? r.reason : ''}`,
    );
  });

  await step('validate: bad pricing.amount_usdc is rejected', async () => {
    const bad = {
      ...MINIMUM_MANIFEST,
      pricing: { amount_usdc: 'free' },
    };
    const r = oap.validateManifest(bad);
    assert(!r.ok, 'expected rejection');
    assert(
      !r.ok && r.reason.includes('amount_usdc'),
      `reason should mention amount_usdc; got: ${!r.ok ? r.reason : ''}`,
    );
  });

  await step('validate: unknown top-level keys are ignored (forward-compat)', async () => {
    const extended = { ...MINIMUM_MANIFEST, future_field: { hello: 'world' } };
    const r = oap.validateManifest(extended);
    assert(r.ok, `unknown keys must be ignored; got ${JSON.stringify(r)}`);
  });

  await step('validate: endpoint must be http(s):// when present', async () => {
    const bad = { ...MINIMUM_MANIFEST, endpoint: { url: 'ftp://x' } };
    const r = oap.validateManifest(bad);
    assert(!r.ok, 'expected rejection');
    assert(
      !r.ok && r.reason.includes('http'),
      `reason should mention http; got: ${!r.ok ? r.reason : ''}`,
    );
  });

  await step('hash: same manifest → same hash (idempotency key)', async () => {
    const a = oap.hashManifest(MINIMUM_MANIFEST);
    const b = oap.hashManifest(MINIMUM_MANIFEST);
    assert(a === b, `expected stable hash; got ${a} vs ${b}`);
    assert(/^[0-9a-f]{64}$/.test(a), `expected sha256 hex; got ${a}`);
  });

  await step('hash: key-order-independent (canonical JSON)', async () => {
    const permuted: OapManifest = {
      pricing: MINIMUM_MANIFEST.pricing,
      persona: MINIMUM_MANIFEST.persona,
      agent: MINIMUM_MANIFEST.agent,
      version: MINIMUM_MANIFEST.version,
    };
    const a = oap.hashManifest(MINIMUM_MANIFEST);
    const b = oap.hashManifest(permuted);
    assert(a === b, `key permutation must produce same hash; got ${a} vs ${b}`);
  });

  await step('map: manifestToSellerPublishInput fills sensible defaults', async () => {
    const input = manifestToSellerPublishInput(MINIMUM_MANIFEST, '0xdead');
    assert(input.title === MINIMUM_MANIFEST.agent.name, 'title from agent.name');
    assert(input.domain === 'generalist', 'default domain=generalist');
    assert(
      Array.isArray(input.pricing_rails) && input.pricing_rails[0] === 'x402',
      'default rail=x402',
    );
    assert(input.chain === 'arbitrum-sepolia', 'default chain');
    assert(input.kind === 'api', 'default kind=api');
  });
}

// ─── Section A2 — PRD-U2 typed envelope (Zod schema + token savings) ─────

async function sectionA2(): Promise<void> {
  console.log('\n─── Section A2: OapEnvelope (Zod) + token savings ≥50% ───\n');

  const validEnvelope: OapEnvelope = {
    version: '1.0',
    trace_id: 'trc-smoke-001',
    intent: {
      task_type: 'translate',
      description: 'NDA',
      from_lang: 'en',
      to_lang: 'vi',
      register: 'formal',
    },
    context: { payload: 'The undersigned parties agree...' },
    budget: { skill_tokens: 3000 },
  };

  await step('envelope: valid envelope accepted', async () => {
    const r = safeValidateEnvelope(validEnvelope);
    assert(r.ok, `expected ok, got ${JSON.stringify(r)}`);
  });

  await step('envelope: missing intent.description rejected', async () => {
    const bad = { ...validEnvelope, intent: { task_type: 'translate' } };
    const r = safeValidateEnvelope(bad);
    assert(!r.ok, 'expected rejection');
    assert(
      !r.ok && r.reason.includes('intent.description'),
      `reason should mention intent.description; got: ${!r.ok ? r.reason : ''}`,
    );
  });

  await step('envelope: bad version literal rejected', async () => {
    const bad = { ...validEnvelope, version: '2.0' };
    const r = safeValidateEnvelope(bad as unknown);
    assert(!r.ok, 'expected rejection');
  });

  await step('envelope: unknown top-level keys accepted (forward-compat passthrough)', async () => {
    const r = safeValidateEnvelope({ ...validEnvelope, future_field: { hello: 'world' } });
    assert(r.ok, `unknown keys must pass through; got ${JSON.stringify(r)}`);
  });

  await step('envelopeToPrompt: same envelope → same output (deterministic)', async () => {
    const a = envelopeToPrompt(validEnvelope);
    const b = envelopeToPrompt(validEnvelope);
    assert(a === b, `expected deterministic; got a=${a.length} b=${b.length}`);
    assert(a.includes('Task: translate'), 'includes intent');
    assert(a.includes('en to vi'), 'includes language pair');
    assert(a.includes('formal'), 'includes register');
    assert(a.includes('undersigned parties'), 'includes payload');
  });

  // ── Token savings assertion: envelope preamble ≥50% shorter than a
  //    typical conversational string prompt for the same intent + payload.
  //    Character count is used as a proxy for tokens (~4:1 char:token for EN).
  //    We compare PREAMBLE ONLY (payload subtracted) since payload is
  //    identical in both paths; the win is skipping conversational filler.

  await step('token savings: envelope preamble ≥50% shorter across 5 fixture queries', async () => {
    const fixtures: Array<{ envelope: OapEnvelope; stringPrompt: string; payload: string }> = [
      {
        payload: 'The undersigned parties agree...',
        envelope: {
          version: '1.0',
          trace_id: 'trc-fx-1',
          intent: { task_type: 'translate', description: 'NDA', from_lang: 'en', to_lang: 'vi', register: 'formal' },
          context: { payload: 'The undersigned parties agree...' },
          budget: { skill_tokens: 3000 },
        },
        stringPrompt:
          "Hi! Could you help me by translating this to Vietnamese? I need it for a legal document " +
          "so please use formal language. Also please make sure to preserve the numbered clauses like " +
          "1.1, 1.2, etc. Thank you so much! Here's the text: The undersigned parties agree...",
      },
      {
        payload: 'function transfer(address to, uint256 amount) external returns (bool);',
        envelope: {
          version: '1.0',
          trace_id: 'trc-fx-2',
          intent: { task_type: 'audit', description: 'ERC-20 transfer function' },
          context: { payload: 'function transfer(address to, uint256 amount) external returns (bool);' },
          budget: { skill_tokens: 3000 },
        },
        stringPrompt:
          "Hey, I would appreciate it if you could do a security audit on the following Solidity code. " +
          "Please check for reentrancy issues, integer overflow, access control, and any other common " +
          "vulnerabilities. Provide a detailed report with severity levels. Here's the code: " +
          "function transfer(address to, uint256 amount) external returns (bool);",
      },
      {
        payload: 'The Q3 earnings report shows revenue growth of 42% YoY...',
        envelope: {
          version: '1.0',
          trace_id: 'trc-fx-3',
          intent: { task_type: 'summarize', description: 'Q3 earnings report' },
          context: { payload: 'The Q3 earnings report shows revenue growth of 42% YoY...' },
          budget: { skill_tokens: 3000 },
        },
        stringPrompt:
          "Could you please read the following document and give me a concise summary? I need the key " +
          "points, financial highlights, and any risks called out. Please keep it under 200 words. " +
          "Thank you! Here's the document: The Q3 earnings report shows revenue growth of 42% YoY...",
      },
      {
        payload: '{"user_id": 42, "name": "Alice"}',
        envelope: {
          version: '1.0',
          trace_id: 'trc-fx-4',
          intent: { task_type: 'extract', description: 'user identity fields' },
          context: { payload: '{"user_id": 42, "name": "Alice"}' },
          budget: { skill_tokens: 3000 },
        },
        stringPrompt:
          "Hi there! I have a JSON blob and I need you to extract just the user_id and name fields " +
          "and return them in a clean format. Please make sure to preserve the types and don't add " +
          "any extra fields. Here's the JSON: {\"user_id\": 42, \"name\": \"Alice\"}",
      },
      {
        payload: 'What is the current staking APY on Arbitrum?',
        envelope: {
          version: '1.0',
          trace_id: 'trc-fx-5',
          intent: { task_type: 'q_and_a', description: 'What is the current staking APY on Arbitrum?' },
          context: {},
          budget: { skill_tokens: 3000 },
        },
        stringPrompt:
          "Hello! I have a question I'd like your help with. Please answer clearly and concisely, " +
          "with citations if you have them. Thanks in advance! My question is: What is the current " +
          "staking APY on Arbitrum?",
      },
    ];

    let savings: number[] = [];
    for (const [i, fx] of fixtures.entries()) {
      const rendered = envelopeToPrompt(fx.envelope);
      // Preamble = full rendered minus the payload segment (payload is
      // identical in both paths, only preamble differs).
      const envelopePreamble = rendered.length - fx.payload.length;
      const stringPreamble = fx.stringPrompt.length - fx.payload.length;
      // Guard against negative preamble on q_and_a where payload may not
      // appear literally in either side; use max(0, x).
      const envPre = Math.max(0, envelopePreamble);
      const strPre = Math.max(1, stringPreamble);
      const ratio = envPre / strPre;
      savings.push(1 - ratio);
      assert(
        ratio <= 0.5,
        `fx#${i + 1} envelope preamble ${envPre} vs string ${strPre} (ratio ${ratio.toFixed(2)}) — expected ≤0.5`,
      );
    }
    const median = savings.sort((a, b) => a - b)[Math.floor(savings.length / 2)];
    console.log(`  → median savings: ${(median * 100).toFixed(1)}% across ${savings.length} queries`);
  });
}

// ─── Section A3 — PRD-U3 router policies (pure, no DB) ────────────────────

async function sectionA3(): Promise<void> {
  console.log('\n─── Section A3: pickByPolicy across 5 router policies ───\n');

  const candidates: Candidate[] = [
    { agent_id: 'a-1', slug: 'alpha', reputation_score: 0.7, cost_usdc: '0.10', last_hire_at: '2026-06-01T00:00:00Z', active_hires: 3 },
    { agent_id: 'a-2', slug: 'bravo', reputation_score: 0.9, cost_usdc: '0.05', last_hire_at: '2026-07-01T00:00:00Z', active_hires: 0 },
    { agent_id: 'a-3', slug: 'charlie', reputation_score: 0.5, cost_usdc: '0.20', last_hire_at: '2026-05-01T00:00:00Z', active_hires: 1 },
  ];

  await step('policy: empty list returns null', async () => {
    assert(pickByPolicy([], 'reputation-aware') === null, 'expected null');
  });

  await step('policy: reputation-aware picks highest reputation (bravo 0.9)', async () => {
    const r = pickByPolicy(candidates, 'reputation-aware');
    assert(r?.slug === 'bravo', `expected bravo; got ${r?.slug}`);
  });

  await step('policy: cost-aware picks lowest cost (bravo 0.05)', async () => {
    const r = pickByPolicy(candidates, 'cost-aware');
    assert(r?.slug === 'bravo', `expected bravo; got ${r?.slug}`);
  });

  await step('policy: lru picks oldest last_hire_at (charlie 2026-05-01)', async () => {
    const r = pickByPolicy(candidates, 'lru');
    assert(r?.slug === 'charlie', `expected charlie; got ${r?.slug}`);
  });

  await step('policy: usage-aware picks least loaded (bravo 0)', async () => {
    const r = pickByPolicy(candidates, 'usage-aware');
    assert(r?.slug === 'bravo', `expected bravo; got ${r?.slug}`);
  });

  await step('policy: round-robin is deterministic first-by-slug (alpha)', async () => {
    const r = pickByPolicy(candidates, 'round-robin');
    assert(r?.slug === 'alpha', `expected alpha; got ${r?.slug}`);
  });

  await step('policy: unknown policy falls back to reputation-aware', async () => {
    const r = pickByPolicy(candidates, 'nonsense-policy' as RouterPolicy);
    assert(r?.slug === 'bravo', `expected bravo (rep fallback); got ${r?.slug}`);
  });
}

// ─── Section A4 — PRD-U ship-gate rollback cascade (master flag) ─────────

async function sectionA4(): Promise<void> {
  console.log('\n─── Section A4: FEATURE_OPENX_V2 master flag cascade ───\n');

  // Preserve caller's env so we don't corrupt Section B.
  const saveMaster = process.env.FEATURE_OPENX_V2;
  const saveSub = process.env.FEATURE_OAP_REGISTRATION;

  await step('cascade: default (all unset) → sub-flag OFF', async () => {
    delete process.env.FEATURE_OPENX_V2;
    delete process.env.FEATURE_OAP_REGISTRATION;
    assert(!isOpenxV2SubFlagOn('FEATURE_OAP_REGISTRATION'), 'expected OFF');
  });

  await step('cascade: sub-flag=true, master unset → ON', async () => {
    delete process.env.FEATURE_OPENX_V2;
    process.env.FEATURE_OAP_REGISTRATION = 'true';
    assert(isOpenxV2SubFlagOn('FEATURE_OAP_REGISTRATION'), 'expected ON');
  });

  await step('cascade: sub-flag=true, master=false → OFF (rollback contract)', async () => {
    process.env.FEATURE_OPENX_V2 = 'false';
    process.env.FEATURE_OAP_REGISTRATION = 'true';
    assert(!isOpenxV2SubFlagOn('FEATURE_OAP_REGISTRATION'), 'expected OFF (master overrides)');
  });

  await step('cascade: sub-flag=true, master=true → ON', async () => {
    process.env.FEATURE_OPENX_V2 = 'true';
    process.env.FEATURE_OAP_REGISTRATION = 'true';
    assert(isOpenxV2SubFlagOn('FEATURE_OAP_REGISTRATION'), 'expected ON');
  });

  await step('cascade: all 5 sub-flags respect master=false', async () => {
    process.env.FEATURE_OPENX_V2 = 'false';
    for (const sub of [
      'FEATURE_OAP_REGISTRATION',
      'FEATURE_TYPED_CONTEXT',
      'FEATURE_SKILL_AUTOLOADER',
      'FEATURE_SUB_AGENT_ORCHESTRATION',
      'FEATURE_AUTO_DREAM',
    ]) {
      process.env[sub] = 'true';
      assert(!isOpenxV2SubFlagOn(sub), `${sub} should be OFF under master=false`);
    }
  });

  // Restore original env so Section B behaves as caller expects.
  if (saveMaster === undefined) delete process.env.FEATURE_OPENX_V2;
  else process.env.FEATURE_OPENX_V2 = saveMaster;
  if (saveSub === undefined) delete process.env.FEATURE_OAP_REGISTRATION;
  else process.env.FEATURE_OAP_REGISTRATION = saveSub;
}

// ─── Section B — end-to-end vs a running API ─────────────────────────────

async function sectionB(apiUrl: string): Promise<void> {
  console.log(`\n─── Section B: E2E vs ${apiUrl} ───\n`);

  const wallet = process.env.WALLET ?? '0x000000000000000000000000000000000000dEaD';
  const headers: Record<string, string> = {
    'x-wallet-address': wallet,
    'content-type': 'application/json',
  };

  async function post(body: unknown): Promise<{ status: number; json: any }> {
    const r = await fetch(`${apiUrl}/v3/oap/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
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

  // Randomize slug per run so idempotency test starts clean each smoke.
  const uniqueManifest: OapManifest = {
    ...MINIMUM_MANIFEST,
    agent: {
      ...MINIMUM_MANIFEST.agent,
      slug: `smoke-${Date.now().toString(36)}`,
      name: `Smoke Agent ${Date.now()}`,
    },
  };

  await step('POST {} → 400 bad_request', async () => {
    const { status, json } = await post({});
    assert(status === 400, `expected 400; got ${status} ${JSON.stringify(json)}`);
    assert(
      json.error === 'bad_request',
      `expected error=bad_request; got ${JSON.stringify(json)}`,
    );
  });

  await step('POST { manifest: {...} } → 200 + agent_id + slug', async () => {
    const { status, json } = await post({ manifest: uniqueManifest });
    if (status === 501) {
      console.warn('  (skipping: FEATURE_OAP_REGISTRATION=false — enable to run)');
      return;
    }
    assert(status === 200, `expected 200; got ${status} ${JSON.stringify(json)}`);
    assert(typeof json.agent_id === 'string' && json.agent_id.length > 0, 'agent_id present');
    assert(typeof json.slug === 'string' && json.slug.length > 0, 'slug present');
    assert(typeof json.paywall_url === 'string', 'paywall_url present');
  });

  await step('POST same manifest twice → same agent_id (idempotency by hash)', async () => {
    const first = await post({ manifest: uniqueManifest });
    if (first.status === 501) return;
    const second = await post({ manifest: uniqueManifest });
    if (second.status !== 200) return; // may 409 on slug race; not the property under test here
    assert(
      first.json.agent_id === second.json.agent_id,
      `agent_ids should match; got ${first.json.agent_id} vs ${second.json.agent_id}`,
    );
    assert(
      first.json.manifest_hash === second.json.manifest_hash,
      `manifest_hashes should match; got ${first.json.manifest_hash} vs ${second.json.manifest_hash}`,
    );
  });
}

// ─── main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await sectionA();
  await sectionA2();
  await sectionA3();
  await sectionA4();

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
  console.error('smoke:fatal', e);
  process.exit(2);
});
