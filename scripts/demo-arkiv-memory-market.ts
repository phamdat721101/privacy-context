#!/usr/bin/env -S npx tsx
/**
 * scripts/demo-arkiv-memory-market.ts — the centerpiece of the demo video.
 *
 * What it does, end-to-end:
 *   1. Boots a Memory-Agent identity from MEMORY_AGENT_PRIVATE_KEY.
 *   2. Writes 5 signed LearnedFacts across 5 topics (POST /v4/memory).
 *   3. Re-queries one topic to demonstrate cache-hit (POST /v4/memory/find).
 *   4. Lists everything for the agent (GET /v4/memory/by-agent/:id).
 *   5. Pays-to-extend the 2 highest-confidence entities (x402 mock receipts).
 *   6. Reads free via createPublicClient (no Fhedin server in the trust path).
 *   7. Prints a colored scoreboard.
 *
 * Exit code 0 on success. Replayable: each run is idempotent in isolation
 * (memory entities accumulate; this is the point of the demo).
 *
 * Run: npm run demo:arkiv-memory-market
 *   or with a remote api: API_URL=https://… npm run demo:arkiv-memory-market
 */

import { keccak256, toBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http } from '@arkiv-network/sdk';
import { braga } from '@arkiv-network/sdk/chains';
import { eq } from '@arkiv-network/sdk/query';
import { buildSigningMessage, type LearnedFact, type AgentDecision } from '@fhe-ai-context/sdk';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

const API = process.env.API_URL ?? 'http://localhost:3001';
const RPC = process.env.ARKIV_RPC_URL ?? 'https://braga.hoodi.arkiv.network/rpc';
const PROJECT = process.env.ARKIV_PROJECT_ATTRIBUTE ?? 'fhedin-ethns-2c4f9a';
const BACKEND_WALLET = (process.env.ARKIV_BACKEND_WALLET ?? '').toLowerCase();
const PK = process.env.MEMORY_AGENT_PRIVATE_KEY as `0x${string}` | undefined;

if (!PK) { console.error('[demo] MEMORY_AGENT_PRIVATE_KEY missing — run `npm run gen:demo-wallets`'); process.exit(1); }
if (!BACKEND_WALLET) { console.error('[demo] ARKIV_BACKEND_WALLET missing — run `npm run gen:demo-wallets`'); process.exit(1); }

const TOPICS = [
  { topic: 'fhe-arbitrum',  fact: 'Fhenix CoFHE wraps an AES-256 key as two euint128 halves in BrainKeyVaultV2.', confidence: 95 },
  { topic: 'erc-8004',      fact: 'ERC-8004 ships three registries: Identity, Reputation, Validation. Mainnet 2026-01.', confidence: 92 },
  { topic: 'phala-tee',     fact: 'Phala Confidential AI returns a hardware attestation with every chat completion.', confidence: 90 },
  { topic: 'arkiv-storage', fact: 'Arkiv entities expire by TTL; extendEntity bumps the lifetime — storage as a market.', confidence: 96 },
  { topic: 'agents-x402',   fact: 'x402 reuses HTTP 402 with WWW-Authenticate: Payment for per-call settlement.',     confidence: 88 },
];

const RED = '\x1b[31m'; const GREEN = '\x1b[32m'; const YELLOW = '\x1b[33m'; const CYAN = '\x1b[36m'; const DIM = '\x1b[2m'; const RESET = '\x1b[0m'; const BOLD = '\x1b[1m';

async function main(): Promise<void> {
  const account = privateKeyToAccount(PK!);
  const agentAddress = account.address as Hex;
  const score = { memories: 0, decisions: 0, topics: TOPICS.length, freeReads: 0, paidExtends: 0, settledUsdc: 0, hits: 0, errors: [] as string[] };
  const writtenKeys: string[] = [];

  console.log(`${BOLD}=== fhedin × arkiv — memory market demo ===${RESET}`);
  console.log(`${DIM}api      :${RESET} ${API}`);
  console.log(`${DIM}arkiv-rpc:${RESET} ${RPC}`);
  console.log(`${DIM}project  :${RESET} ${PROJECT}`);
  console.log(`${DIM}agent    :${RESET} ${agentAddress}`);
  console.log(`${DIM}backend  :${RESET} ${BACKEND_WALLET}\n`);

  // 1. WRITE 5 (memory, decision) pairs
  for (const [i, t] of TOPICS.entries()) {
    const topicHash = keccak256(toBytes(t.topic)).slice(2, 18);

    // 1a. Memory
    const unsignedMem: Omit<LearnedFact, 'signature'> = {
      fact: t.fact,
      source: { brainId: 100 + i, queryHash: keccak256(toBytes(t.topic + ':seed')).slice(2, 18) },
      confidence: t.confidence,
      derivedAt: Date.now(),
      signer: agentAddress,
    };
    const memSig = await account.signMessage({ message: buildSigningMessage(unsignedMem) });
    const fact: LearnedFact = { ...unsignedMem, signature: memSig as Hex };
    try {
      const r = await fetch(`${API}/v4/memory`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-wallet-address': agentAddress },
        body: JSON.stringify({ fact, topic: topicHash }),
      });
      if (!r.ok) { score.errors.push(`mem ${t.topic}: ${r.status} ${await r.text()}`); }
      else { const body = await r.json(); writtenKeys.push(body.entityKey); score.memories += 1;
        console.log(`${GREEN}[memory]${RESET}  ${t.topic.padEnd(14)} → ${DIM}${body.entityKey.slice(0, 14)}…${RESET}`); }
    } catch (err) { score.errors.push(`mem ${t.topic}: ${(err as Error).message}`); }

    // 1b. Decision (2nd entity type — AI reputation log)
    const unsignedDec: Omit<AgentDecision, 'signature'> = {
      decision: i === 0 ? 'query-brain' : 'use-prior',  // first = miss, rest = simulated cache-hit
      topic: topicHash,
      priorFactCount: i,
      chosenAt: Date.now(),
      signer: agentAddress,
    };
    const decSig = await account.signMessage({ message: buildSigningMessage(unsignedDec) });
    const decision: AgentDecision = { ...unsignedDec, signature: decSig as Hex };
    try {
      const r = await fetch(`${API}/v4/decisions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-wallet-address': agentAddress },
        body: JSON.stringify({ decision, topic: topicHash }),
      });
      if (!r.ok) { score.errors.push(`dec ${t.topic}: ${r.status} ${await r.text()}`); }
      else { const body = await r.json(); score.decisions += 1;
        console.log(`${YELLOW}[decide]${RESET}  ${t.topic.padEnd(14)} → ${DIM}${body.entityKey.slice(0, 14)}…${RESET}  verdict=${unsignedDec.decision}`); }
    } catch (err) { score.errors.push(`dec ${t.topic}: ${(err as Error).message}`); }
  }

  // 2. FIND — should hit at least one fact for the first topic
  const probeTopic = keccak256(toBytes(TOPICS[0].topic)).slice(2, 18);
  try {
    const r = await fetch(`${API}/v4/memory/find`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: agentAddress, topic: probeTopic, minConfidence: 80 }),
    });
    if (r.ok) {
      const body = await r.json();
      score.freeReads += 1;
      score.hits = body.count ?? 0;
      console.log(`${CYAN}[find ]${RESET}  topic=${TOPICS[0].topic.padEnd(14)} → ${body.count ?? 0} hits`);
    }
  } catch (err) { score.errors.push(`find: ${(err as Error).message}`); }

  // 3. LIST — paginated public read
  try {
    const r = await fetch(`${API}/v4/memory/by-agent/${agentAddress}?limit=20`);
    if (r.ok) {
      const body = await r.json();
      score.freeReads += 1;
      console.log(`${CYAN}[list ]${RESET}  by-agent → ${body.items?.length ?? 0} items`);
    }
  } catch (err) { score.errors.push(`list: ${(err as Error).message}`); }

  // 4. EXTEND 2 entities (pay-to-extend, x402)
  for (const key of writtenKeys.slice(0, 2)) {
    try {
      const r1 = await fetch(`${API}/v4/memory/${key}/extend`, { method: 'POST' });
      if (r1.status !== 402) { score.errors.push(`expected 402 on extend, got ${r1.status}`); continue; }
      const wwwAuth = r1.headers.get('WWW-Authenticate') ?? '';
      const idMatch = wwwAuth.match(/id="([^"]+)"/);
      if (!idMatch) { score.errors.push('no challenge id in 402'); continue; }
      const r2 = await fetch(`${API}/v4/memory/${key}/extend`, {
        method: 'POST',
        headers: { Authorization: `Payment exact ${idMatch[1]} demo-receipt-${Date.now()}` },
      });
      if (r2.ok) {
        score.paidExtends += 1;
        score.settledUsdc += 0.01;
        console.log(`${YELLOW}[extend]${RESET} ${DIM}${key.slice(0, 14)}…${RESET} +30d (paid 0.01 USDC)`);
      } else { score.errors.push(`extend ${key}: ${r2.status}`); }
    } catch (err) { score.errors.push(`extend ${key}: ${(err as Error).message}`); }
  }

  // 5. INDEPENDENT VERIFICATION — read the same data via createPublicClient
  try {
    const reader = createPublicClient({ chain: braga, transport: http(RPC) });
    const result = await reader.buildQuery()
      .where([eq('project', PROJECT), eq('entityType', 'agent-memory'), eq('agentId', agentAddress.toLowerCase())])
      .createdBy(BACKEND_WALLET as Hex)
      .withAttributes(true)
      .limit(50)
      .fetch();
    score.freeReads += result.entities.length;
    console.log(`${CYAN}[verify]${RESET} createPublicClient saw ${result.entities.length} entities (no Fhedin server in path)`);
  } catch (err) { score.errors.push(`verify: ${(err as Error).message}`); }

  // 6. SCOREBOARD
  console.log(`\n${BOLD}┌── fhedin × arkiv memory market ──┐${RESET}`);
  printRow('memories written',   String(score.memories));
  printRow('decisions written',  String(score.decisions));
  printRow('topics covered',     String(score.topics));
  printRow('cache hits (find)',  String(score.hits));
  printRow('free reads',         String(score.freeReads));
  printRow('paid extends',       String(score.paidExtends));
  printRow('USDC settled',       `$${score.settledUsdc.toFixed(2)}`);
  console.log(`${BOLD}└──────────────────────────────────┘${RESET}`);
  if (score.errors.length) {
    console.log(`\n${RED}${score.errors.length} non-fatal error(s):${RESET}`);
    for (const e of score.errors) console.log(`  ${DIM}- ${e}${RESET}`);
  }
  if (score.memories === 0) { console.error(`\n${RED}❌ no memories written — check the api is up on ${API}${RESET}`); process.exit(1); }
  console.log(`\n${GREEN}✅ memory market online${RESET}`);
  console.log(`${DIM}   block explorer:  https://explorer.braga.hoodi.arkiv.network${RESET}`);
  console.log(`${DIM}   data explorer :  https://data.arkiv.network?owner=${BACKEND_WALLET}${RESET}\n`);
}

function printRow(label: string, value: string): void {
  const padded = label.padEnd(20);
  console.log(`│ ${padded} ${value.padStart(11)} │`);
}

main().catch((err) => { console.error(`${RED}❌ demo failed:${RESET}`, (err as Error).message); process.exit(1); });
