# Fhedin · A wallet-owned memory layer for AI agents on Arkiv

> **Theme: AI + Privacy hybrid.** Agents whose memory you actually own (AI), with a selective AES-256-GCM envelope and TTL-based auto-revoke (Privacy).

| Submission item | Where |
|---|---|
| **Theme(s)** | AI + Privacy hybrid (declared per [submission form](https://forms.arkiv.network/ethns-arkiv-challenge)) |
| **Public repo** | https://github.com/phamdat721701/privacy-context (MIT) |
| **Working demo (api)** | https://13-229-63-192.sslip.io · [`/v4/version`](https://13-229-63-192.sslip.io/v4/version) · [`/openapi.json`](https://13-229-63-192.sslip.io/openapi.json) |
| **Working demo (frontend)** | `npm run dev` from a clean clone — under 60s to a signed Arkiv write |
| **Demo video** | 2–3 min walkthrough script in [§ Record the demo](#record-the-demo) |
| **Project attribute** | `fhedin-ethns-2c4f9a` — globally unique, stamped on every entity & every query |
| **Entity types** | `agent-memory` (30d TTL) · `agent-decision` (7d TTL) — differentiated expiration per data class |
| **License** | MIT |

## Network — Arkiv Braga (verbatim from the challenge FAQ)

| | |
|---|---|
| Network ID | `60138453102` |
| HTTP RPC | `https://braga.hoodi.arkiv.network/rpc` |
| WebSocket RPC | `wss://braga.hoodi.arkiv.network/rpc/ws` |
| Standard Bridge | `0xB52b417A79c9dE21ffe221dF9a3821B7EaC60813` |
| Faucet | https://braga.hoodi.arkiv.network/faucet/ |
| Explorer | https://explorer.braga.hoodi.arkiv.network/ |
| Data Explorer | https://data.arkiv.network/ |
| SDK | `@arkiv-network/sdk` **0.6.8** (pinned) |

---

## Quick start (≤ 5 minutes from clean clone)

```bash
# 1. Clone + install
git clone https://github.com/phamdat721701/privacy-context.git
cd privacy-context
npm install

# 2. Install Arkiv's official agent skill — your AI assistant stops inventing SDK calls
npx skills add https://github.com/arkiv-network/skills --skill arkiv-best-practices

# 3. Mint three fresh demo wallets (chmod-600 .env.local; secrets never log)
npm run gen:demo-wallets

# 4. Top up the addresses printed by step 3 — Braga (GLM gas) + USDC + ETH
#      https://braga.hoodi.arkiv.network/faucet/

# 5. Smoke-test the SDK + Braga roundtrip
ARKIV_LIVE=1 npm run smoke:arkiv      # writes one entity, reads it back, prints tx hash

# 6. Boot the full stack (api + frontend, with Memory-Agent v1 firing)
npm run dev                            # → http://localhost:3000/memory?lane=mine
```

The `dev` script (`scripts/start-dev.sh`) is one command — pre-flight checks, SDK build, api on `:3001`, frontend on `:3000`, banner with every URL a judge needs. `Ctrl+C` tears both processes down.

To replay the end-to-end demo against the live api:

```bash
# Run against prod (writes 5 memories + 5 decisions, pays-to-extend two,
# verifies via createPublicClient — colored scoreboard at the end)
API_URL=https://13-229-63-192.sslip.io npm run demo:arkiv-memory-market
```

---

## What it is

Fhedin is a **publish-and-earn marketplace where AI agents pay you in USDC to read knowledge only you control** (Patreon for AI agents). The Arkiv tier — the focus of this submission — gives both the agent and the user a queryable, public, wallet-owned memory layer alongside Fhedin's existing FHE-encrypted brain layer.

The thesis behind picking Arkiv as the database (not Postgres, not Walrus, not Ceramic):

| Choice | Queryable? | Native TTL? | Tamper-proof source? | Live event stream? |
|---|---|---|---|---|
| Postgres / Supabase | ✅ SQL | ✗ | ✗ (DB admin can rewrite) | ✗ |
| Walrus / Filecoin | ✗ raw blobs | ✗ | ✗ | ✗ |
| Ceramic | ✗ no native indexed range queries | ✗ | ✓ via `did:pkh` | ✗ |
| **Arkiv (Braga)** | ✅ via attributes (`gt`/`lt`/`eq`) | ✅ first-class `expiresIn` + `extendEntity` | ✅ immutable `$creator` | ✅ `subscribeEntityEvents` |

**Storage TTL is the market mechanic.** Anyone can pay 0.01 USDC to extend a memory's lifetime (`POST /v4/memory/:key/extend`). Anyone can read any memory for free via `createPublicClient`. The platform is provably blind because the user signs the entity with their own wallet — not Fhedin's.

---

## How Arkiv is used as the DB (mapped to the [scoring rubric](https://github.com/Arkiv-Network/arkiv-ethns-builder-challenge/blob/main/docs/scoring-rubric.md))

The rubric weights **Arkiv Integration Depth at 40%** — six sub-criteria. Each maps to specific code:

### 1. Entity schema design

Two entity types, both schema-validated end-to-end. Project attribute `fhedin-ethns-2c4f9a` stamped on every entity AND every query (per `docs/builders-guide.md` Best Practice).

| Type | TTL | Use | Code |
|---|---|---|---|
| `agent-memory` | 30 days | LearnedFact: signed claim about something the agent knows | [`packages/sdk/src/memory/types.ts`](packages/sdk/src/memory/types.ts) |
| `agent-decision` | 7 days | Per-cycle reputation log: `use-prior` vs `query-brain` verdict | [`packages/sdk/src/memory/types.ts`](packages/sdk/src/memory/types.ts) |

Attribute typing is correct: `confidence`, `priorFactCount`, `sourceBrain`, `createdAt`, `confidential` are **numeric** (range-queryable); `agentId`, `topic`, `decision`, `entityType`, `project` are **strings**. No array-as-attribute anti-patterns — relationships are modelled as shared keys.

### 2. Query usage

Multiple filter combinations, signature-verified parses, cursor pagination. See `findRelevant`, `findByOwner`, `findDecisions` in [`packages/api/src/services/arkivMemoryService.ts`](packages/api/src/services/arkivMemoryService.ts):

```ts
reader.buildQuery()
  .where([eq('project', PROJECT), eq('entityType', 'agent-memory'), eq('agentId', a)])
  .where(gt('confidence', 80))            // numeric range filter
  .createdBy(BACKEND_WALLET)              // tamper-proof source filter
  .orderBy(desc('createdAt', 'number'))   // server-side ordering
  .withPayload(true).withAttributes(true)
  .limit(50)
  .fetch();
```

Browser-side direct reads from Arkiv (no API in the trust path) live in [`packages/frontend/src/lib/arkiv.ts`](packages/frontend/src/lib/arkiv.ts) — `fetchMemoriesByAgent`, `fetchMyMemories`, `fetchDecisionsByAgent`, `subscribeMemoryEvents`.

### 3. Ownership model

**Two writers, one namespace** — distinguished only by `$creator`:

| Tier | Who signs `createEntity` | `$owner` | Pays GLM |
|---|---|---|---|
| **Platform** (Memory-Agent v1) | server-side `ARKIV_BACKEND_PRIVATE_KEY` | backend wallet | platform |
| **Sovereign** (NEW) | the **user's** Privy / MetaMask wallet | user wallet | user (faucet) |

The Sovereign tier uses [`@arkiv-network/sdk` browser pattern](https://docs.arkiv.network/learn/metamask-sketch-app/2-data/) — `createWalletClient({ chain: braga, transport: custom(provider) })`. The user signs each `createEntity` themselves; the entity's `$creator` is permanently the user, never Fhedin. See [`packages/frontend/src/lib/arkivBrowserClient.ts`](packages/frontend/src/lib/arkivBrowserClient.ts).

Filters use both:
- `.createdBy(backendWallet)` — tamper-proof source filter for platform-signed entities (Best Practice #12)
- `.ownedBy(userWallet)` — Sovereign-tier reads, forward-compatible with future ownership transfers

### 4. Entity relationships

Shared-attribute foreign keys per the [builders-guide pattern](https://github.com/Arkiv-Network/arkiv-ethns-builder-challenge/blob/main/docs/builders-guide.md#3-relationships-are-shared-attribute-keys):

```
LearnedFact { agentId: "0xMemAgent…", topic: "fhe-arbitrum",  …, confidence: 95 }
                 │                       │
                 └───────────┬───────────┘  shared attribute keys
                             ▼
AgentDecision { agentId: "0xMemAgent…", topic: "fhe-arbitrum", …, decision: "use-prior" }
```

A single query joins them: `where(eq('agentId', X)).where(eq('topic', T))` returns both the memory and the decision that produced it. No array hacks, no orphans.

### 5. Expiration dates

Differentiated per entity class — uses `ExpirationTime` helpers, never raw seconds:

| Class | TTL | Why |
|---|---|---|
| `agent-memory` | `60 * 60 * 24 * 30` (30d) | Long-term beliefs; users + agents revisit |
| `agent-decision` | `60 * 60 * 24 * 7` (7d) | Reputation log; older decisions are noise |
| Pay-to-extend | `+30d` per call | TTL-as-funding (the market mechanic) |

`extendEntity()` is wired through `POST /v4/memory/:key/extend` with an HTTP 402 paywall (x402 USDC). See [`packages/api/src/routes/v4.ts`](packages/api/src/routes/v4.ts).

### 6. Advanced features

- **Wallet-signed Sovereign writes** with `wallet_switchEthereumChain` → `wallet_addEthereumChain` fallback (EIP-3326 + EIP-3085 canonical pattern). User pays own GLM, receives true `$owner = self`.
- **Selective AES-256-GCM envelope** on confidential memories. The `confidential: 1` attribute is a query-time signal; the payload is opaque. See `decisionToEntityInput` / `fromEntity` in [`packages/sdk/src/memory/serialize.ts`](packages/sdk/src/memory/serialize.ts).
- **Canonical-JSON signing with off-chain signature recovery** — every entity carries a `signer + signature` pair inside the payload. `fromEntity` calls `recoverMessageAddress` and skips entities that fail (logged at WARN). Tamper-proof authorship even if `$creator` is the platform relay.
- **Live event subscription** via `subscribeEntityEvents` (poll 2s) — drives the live `/memory` feed. Same primitive powers the "+0.01 USDC" receipt animation.
- **Read-back chat** at `POST /v4/chat-with-memory` queries `ownedBy(userWallet)`, feeds the result into a strict prompt that may **only cite returned memories**, never invent. Citations rendered as inline `[1]`-style links to live Arkiv entities.
- **Independent verification panel** — global `🛡️ verify on arkiv` button opens twin iframes (Braga block explorer + `data.arkiv.network`) plus three copy-buttons: memories DSL, decisions DSL, Node `createPublicClient` script.

---

## Architecture

```
                     ┌─────────────────────────────────────┐
                     │  /memory page · two lanes           │
                     │   ┌──────────────┬──────────────┐   │
                     │   │  Platform    │  Yours       │   │
                     │   │  (Memory-    │  (sovereign  │   │
                     │   │   Agent v1)  │   user-      │   │
                     │   │              │   signed)    │   │
                     │   └──────────────┴──────────────┘   │
                     │       Save form · Read-back chat    │
                     └────────────────┬────────────────────┘
       browser-side createPublicClient│   (Privy embedded /
                                      │    MetaMask EIP-1193)
                                      ▼
        ┌──────────────────── Arkiv-Braga ────────────────────┐
        │  entityType=agent-memory   project=fhedin-ethns-2c4f9a│
        │  entityType=agent-decision                            │
        │     │                              │                  │
        │     ▼                              ▼                  │
        │  $creator filter:           ownedBy filter:           │
        │  Platform writes by         Sovereign writes by       │
        │  ARKIV_BACKEND wallet       the user's own wallet     │
        └────────────────────────────────────────────────────────┘
                  ▲                              ▲
   server-side    │                              │  api routes
 walletClient ────┘                              └──── /v4/memory · /v4/decisions
 (Memory-Agent v1                                       /v4/chat-with-memory
  cron loop —                                            /v4/onboard/unfurl
  agentId+topic shared
  with sovereign lane)
```

Three independent paths to the same data — the rubric's "composability" requirement:

1. **Web UI** — `/memory` page reads via `createPublicClient`, no server in the trust path
2. **HTTP** — `GET /v4/memory/by-agent/:wallet` + `POST /v4/chat-with-memory`
3. **Direct** — paste the DSL query string into [data.arkiv.network](https://data.arkiv.network) or run the `createPublicClient` snippet in a Node REPL (both copyable from the in-app verify panel)

---

## Tech stack

| Layer | Tool | Why |
|---|---|---|
| Data layer (this submission) | **Arkiv `@arkiv-network/sdk@0.6.8`**, Braga testnet | Queryable + TTL-priced + `$creator` immutable |
| Frontend | Next.js 14 (App Router) + Tailwind | Static-route `/memory` page, App-Shell with two-lane Yours/Platform tabs |
| Wallet | Privy embedded + MetaMask via EIP-1193 | One pattern for both — see `arkivBrowserClient.ts` |
| API | Express + TypeScript + Pino | Lightweight; v4 routes additive over the existing v2/v3 |
| LLM | Phala TEE (Confidential AI) with Bedrock fallback | Attested chat answers — already wired in `chat.ts` |
| SDK | TS workspace `@fhe-ai-context/sdk` | Shared schema between server, frontend, demo scripts |
| Auth (humans) | Privy | Email + embedded wallet auto-onboard |

Build orchestration is monorepo (`npm workspaces`):

```bash
npm run sdk:build           # tsc; api + frontend depend on its dist
npm run api:build           # tsc to dist
npm run frontend:build      # next build (prebuild auto-runs sdk + ui builds)
npm run build               # all four packages clean
```

Deploy is one command:
- API: rsync `packages/api/{src,package.json}` to the VPS, `npm run sdk:build && npm run api:build && pm2 restart fhe-brain-api --update-env`
- Frontend: `npm run frontend:build && npm run frontend:start` (or push to Vercel — `prebuild` script runs SDK + UI builds inside the workspace)

---

## Run all the demos

```bash
npm run smoke:arkiv                       # 1 entity write + read (gated by ARKIV_LIVE=1)
npm run gen:demo-wallets                  # one-shot mint 3 fresh wallets to .env.local
npm run drain:leaked                      # one-shot consolidation of test funds (decommission policy)
npm run demo:arkiv-memory-market          # full e2e + colored scoreboard
npm run demo:agentic-market               # legacy v3 demo (multi-rail x402 / MPP / Sui-USDC)
npm run dev                               # full stack locally
```

Verify any memory yourself, no Fhedin server required:

```ts
import { createPublicClient, http } from '@arkiv-network/sdk';
import { braga } from '@arkiv-network/sdk/chains';
import { eq } from '@arkiv-network/sdk/query';

const c = createPublicClient({ chain: braga, transport: http() });
const r = await c.buildQuery()
  .where([eq('project', 'fhedin-ethns-2c4f9a'), eq('entityType', 'agent-memory')])
  .createdBy('0x100690a32b562fd45e685bc2e63bbff566d452db')
  .withPayload(true).withAttributes(true).limit(20).fetch();
console.log(JSON.stringify(r.entities, null, 2));
```

---

## Team

| Name | GitHub | Role |
|---|---|---|
| Pham Nim | [@phamdat721701](https://github.com/phamdat721701) | Solo / lead — design, contracts, SDK, API, frontend |

Project repo: <https://github.com/phamdat721701/privacy-context>
Project name: **Fhedin**

EVM wallet for prize disbursement: _provided on the submission form, not in this repo_.

---

## Project structure

```
docs/
├── ARKIV_INTEGRATION.md  ← deep-dive: rubric scorecard + verification recipes
├── USP_BRIEF.md          ← Fhedin product north star
├── PROJECT_CONTEXT.md    ← engineering snapshot
├── SECURITY.md           ← decommissioned keys + threat model
└── research/             ← Web3-memory-landscape competitive analysis

packages/
├── api/                  ← Express; /v4 routes (memory, decisions, chat-with-memory, unfurl)
├── frontend/             ← Next.js 14; /memory page (two-lane), Sovereign save form, MemoryChat
├── sdk/                  ← typed schemas (LearnedFact, AgentDecision) + canonical-JSON signing
├── ui/, runtime-utils/   ← shared design tokens + resilientCall/HMAC helpers
├── shared/               ← types, DB config, contract ABIs (v2)
├── contracts/            ← Solidity v2 (BrainKeyVaultV2 — Fhenix tier, separate from this submission)
└── (sui-sdk/sui-contracts/agent/worker/zama-contracts: parked)

scripts/
├── start-dev.sh                   ← one-command full-stack runner
├── gen-demo-wallets.ts            ← chmod-600 wallet provisioner
├── drain-leaked-wallet.ts         ← one-shot decommission of test funds
├── smoke-arkiv.ts                 ← write+read roundtrip
├── demo-arkiv-memory-market.ts    ← end-to-end with colored scoreboard
└── demo-agentic-market.ts         ← legacy v3 demo

new-ui/                            ← Figma-export HTML mockups (reference only)
```

---

## Beyond the hackathon — Fhedin's USP

> Section preserved for context — not part of the Builder Challenge submission scope.

Fhedin's broader thesis: a marketplace where AI agents pay you in USDC to query knowledge only you control. The platform is cryptographically blind to both sides. The Arkiv tier (this submission) is one of three coexisting tiers:

| Tier | Stack | Status |
|---|---|---|
| Standard (FHE) | Fhenix CoFHE on Arbitrum + Phala TEE inference | Live (v2 contracts on Arbitrum Sepolia) |
| Trustless | Sui Seal + Walrus + Phala TEE | Mock-first, deferred |
| **Memory** | **Arkiv-Braga** | **This submission** |

Fhenix v2 contracts on Arbitrum Sepolia (out of scope for this judging, included for context):

- [`SubscriptionControllerV2`](https://sepolia.arbiscan.io/address/0x648d6b39360A53f604f9e808721eB7d780AabcA3)
- [`KnowledgeBaseRegistryV2`](https://sepolia.arbiscan.io/address/0x97878Cb32C6c8A56e0604218C41C683a94CD075e)
- [`BrainKeyVaultV2`](https://sepolia.arbiscan.io/address/0x9a6BcBea6De59FE19d7d1648EFb3F1Ee36331156)

Read more in [`docs/USP_BRIEF.md`](docs/USP_BRIEF.md).

---

## License

MIT. See [`LICENSE`](LICENSE) (or [`docs/RULES.md`](https://github.com/Arkiv-Network/arkiv-ethns-builder-challenge/blob/main/RULES.md) § 9 — challenge IP terms).

*Privacy is not a feature; it's the architecture. Memory is not a feature; it's the marketplace.*
