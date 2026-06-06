# OpenX — the AI Memory Marketplace on Sui

> **Walrus + MemWal remember. OpenX monetizes the remembering.**
> Sellers publish brains once. Agents pay USDC per query. Every answer ships with a Sui tx digest, a Walrus blob id, and a Phala TEE attestation hash.

| | |
|---|---|
| **Live API** | https://13-229-63-192.sslip.io · [`/health`](https://13-229-63-192.sslip.io/health) · [`/v3/memory/marketplace`](https://13-229-63-192.sslip.io/v3/memory/marketplace) |
| **Sui package** | [`0x4a76…2041`](https://suiscan.xyz/testnet/object/0x4a760f6c982fbbe814dadb11adfe1a6c6d50bcce156de578b5f33e442f0e2041) (testnet) |
| **License** | MIT |

---

## How OpenX uses MemWal

[MemWal](https://docs.wal.app) is Mysten Labs' L1–L5 cognitive memory primitive on Sui. It can `remember`, `recall`, `analyze`, and `restore` text into a per-namespace memory account. OpenX wraps MemWal with three things it lacks on its own: **payments, ownership, and a marketplace**.

```
       Buyer agent (MCP / browser / API)
                  │
                  │  POST /v3/memory/brain/:id/query
                  │  x-payment-rail: sui_usdc | x402 | mpp
                  ▼
        ┌──── OpenX API ─────┐
        │ auth → pay → recall│
        └────┬───────────┬───┘
             │           │
   Sui Move tx      OpenXMemWalAdapter
   (operator-signed)     │
        │                ├─→ MemWal upstream  (L1–L5 cognitive recall)
        ▼                ├─→ Walrus           (encrypted blob payload)
PaidQueryRecorded        └─→ Phala TEE        (attested inference)
SettlementBatchEmitted
```

A seller calls `publish_brain` on the OpenX Move package. The Move call mints a `MemWalBrain` shared object that pins:

- a **Walrus blob id** — the encrypted brain payload,
- a **MemWal namespace** — where L1–L5 facts live,
- a **price** in USDC, and
- a **subscription policy** (free / paid / KYA-gated).

Buyers hit `/v3/memory/brain/:id/query`. The API proves payment, calls MemWal `recall` through the operator pool, returns the answer with a three-proof receipt, and emits `PaidQueryRecorded` on Sui. Settlement is batched every 60s.

The single supported entry point into MemWal is `packages/sdk/src/memwal/adapter.ts`. SOLID by construction:

- **SRP** — one class, `OpenXMemWalAdapter`. Round-robin pool, peer-dep loader, and rate guard are private helpers (<30 lines each).
- **DIP** — Redis, payment gate, FHE envelope, and logger are constructor-injected. No module-level imports of the upstream `@mysten-incubation/memwal` package.
- **OCP** — to add a new op, extend `POINT_COSTS` and add a public method that calls `runOp(...)`. The kernel is unchanged.
- **G4 isolation** — `@mysten-incubation/memwal` only loads when `MEMWAL_PEERDEP_ENABLED=true`. Standard-tier installs never trigger the import.

---

## Proof of work

Everything below is real, on-chain, and queryable from any browser.

### Sui testnet

| Artifact | Id / digest | Explorer |
|---|---|---|
| OpenX Move package | `0x4a760f6c982fbbe814dadb11adfe1a6c6d50bcce156de578b5f33e442f0e2041` | [Suiscan](https://suiscan.xyz/testnet/object/0x4a760f6c982fbbe814dadb11adfe1a6c6d50bcce156de578b5f33e442f0e2041) |
| Deploy tx | `3ScQEmpxmBmv3U8vUqL9ip73J771rSTK21mfdrt61hjz` | [Suiscan](https://suiscan.xyz/testnet/tx/3ScQEmpxmBmv3U8vUqL9ip73J771rSTK21mfdrt61hjz) |
| Sample `MemWalBrain` (price $0.05/query) | `0x728e0a23f573b9f2c837e959064c643aba0a9fc6b9c11fb300f01d26334e35ea` | [Suiscan](https://suiscan.xyz/testnet/object/0x728e0a23f573b9f2c837e959064c643aba0a9fc6b9c11fb300f01d26334e35ea) |
| Publish tx | `A1twpRRaACTwn1rjQV6PgRtqGGcPFWR6SaUuuaCizt4m` | [Suiscan](https://suiscan.xyz/testnet/tx/A1twpRRaACTwn1rjQV6PgRtqGGcPFWR6SaUuuaCizt4m) |
| Operator wallet | `0x7b9a9e7b878863cc14adcf2f3ff29094454d3b1fe78d00637cb81dc29ce7ce96` | [Suiscan](https://suiscan.xyz/testnet/address/0x7b9a9e7b878863cc14adcf2f3ff29094454d3b1fe78d00637cb81dc29ce7ce96) |
| Upstream MemWal package (Mysten) | `0xcf6ad755a1cdff7217865c796778fabe5aa399cb0cf2eba986f4b582047229c6` | [Suiscan](https://suiscan.xyz/testnet/object/0xcf6ad755a1cdff7217865c796778fabe5aa399cb0cf2eba986f4b582047229c6) |

The OpenX Move package contains 11 modules: `openx_memwal_marketplace`, `openx_memwal_billing`, `openx_memwal_revenue_split`, `brain_registry`, `subscription_policy`, `workflow`, `skill`, `reflective`, `agent_billing`, `agent_module`, `kya_gate`. **43/43 Move tests pass.**

### Arbitrum Sepolia (Standard tier — FHE key vault)

| Contract | Address |
|---|---|
| `BrainKeyVaultV2` | [`0x9a6BcBea6De59FE19d7d1648EFb3F1Ee36331156`](https://sepolia.arbiscan.io/address/0x9a6BcBea6De59FE19d7d1648EFb3F1Ee36331156) |
| `KnowledgeBaseRegistryV2` | [`0x97878Cb32C6c8A56e0604218C41C683a94CD075e`](https://sepolia.arbiscan.io/address/0x97878Cb32C6c8A56e0604218C41C683a94CD075e) |
| `SubscriptionControllerV2` | [`0x648d6b39360A53f604f9e808721eB7d780AabcA3`](https://sepolia.arbiscan.io/address/0x648d6b39360A53f604f9e808721eB7d780AabcA3) |

### Verify it yourself

```bash
curl https://13-229-63-192.sslip.io/health
curl https://13-229-63-192.sslip.io/v3/memory/marketplace
curl https://13-229-63-192.sslip.io/api/v1/sui-audit-1780681145/.well-known/agent.json
```

---

## Run it locally

Requires Node 20+, Postgres 14+, and a Sui testnet wallet.

```bash
git clone https://github.com/phamdat721701/privacy-context.git openx
cd openx
npm install
cp .env.example .env.local        # set DATABASE_URL + PRIVY_APP_ID
npm run dev                       # API :3001 + frontend :3000
```

Then open http://localhost:3000 → sign in with Privy → switch to **Sui Testnet** → publish a brain at `/brain-sui/new`. The publish flow writes the encrypted blob to Walrus, registers the namespace on MemWal, and mints a `MemWalBrain` shared object on Sui.

Run all smoke tests offline:

```bash
bash scripts/run-all-smokes.sh
```

Drive the live testnet marketplace end-to-end (publishes, pays, settles):

```bash
API_URL=https://13-229-63-192.sslip.io \
PHAM_WALLET_ADDRESS=0x… PHAM_PRIVATE_KEY=0x… \
SEED_SUI_OBJECT_ID=0x… SEED_WALRUS_BLOB_ID=walrus:… \
  npm run seed:tri-marketplace
```

The 7-step DAG runs in <90s, costs ~$1.50 testnet-USDC, and streams a per-step receipt with Walrus blob ids + Phala attestations.

---

## Repo layout

```
packages/
├── api/             Express API · /v2 opaque · /v3 agentic
├── frontend/        Next.js 14 · landing, brain, marketplace, studio, chat
├── sdk/             schemas, cognitive memory, memwal adapter
├── sui-sdk/         Sui + Walrus + Seal + Phala TEE clients
├── sui-contracts/   Move package — 43 tests
├── contracts/       Solidity v2 (BrainKeyVaultV2, KnowledgeBaseRegistryV2, …)
└── runtime-utils/   resilientCall + circuit breaker + HMAC

scripts/
├── start-dev.sh                  full-stack one-command runner
├── seed-tri-marketplace.ts       seed live marketplace
├── setup-memwal-delegate.ts      register operator delegate keys
└── smoke-*.ts                    walrus, memwal-adapter, marketing-workflow…

docs/
├── PROJECT_CONTEXT.md   engineering snapshot — start here
├── USP_BRIEF.md         product north star
└── SECURITY.md          threat model
```

Build orchestration is `npm workspaces`. **Each workspace owns its own dep build chain**, so any package builds standalone — Vercel builds `frontend` and the chain `runtime-utils → sdk → ui` runs automatically:

```bash
npm run build              # runtime-utils → sdk → ui → sui-sdk → openx-mcp → api
npm run sdk:build          # standalone — auto-builds runtime-utils first
npm run frontend:build     # standalone — auto-builds runtime-utils + sdk + ui
```

---

## Tech stack

| Layer | Tool |
|---|---|
| Settlement | Sui Move (shared objects, deterministic events) |
| Memory | MemWal — L1 working → L5 reflective |
| Storage | Walrus — encrypted blobs, Quilt batching |
| Inference | Phala TEE (Confidential AI); Bedrock Claude fallback |
| Key custody | Fhenix CoFHE on Arbitrum (Standard tier) |
| Frontend | Next.js 14 + Privy + dapp-kit |
| API | Express + TypeScript + Pino |
| Payments | x402 · MPP · Sui-USDC · Stellar · XRPL · FHERC20 — one `payRouter.ts` |

---

## License

MIT. © Pham Nim ([@phamdat721701](https://github.com/phamdat721701)) — solo build: Move, Solidity, SDK, API, frontend.

*Privacy is the architecture. Earnings are the artifact.*
