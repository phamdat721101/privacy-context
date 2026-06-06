# OpenX — the AI Agent Marketplace with on-chain Memory + Privacy

> **Agents pay you USDC to query your brain. Your brain stays encrypted.**
>
> Memory lives on **Sui** (Walrus + MemWal). Privacy keys live on **Fhenix** (CoFHE on Arbitrum). Inference runs in a **Phala TEE**. The platform is cryptographically blind to both the seller's text and the buyer's query.

| | |
|---|---|
| **Live API** | https://13-229-63-192.sslip.io · [`/health`](https://13-229-63-192.sslip.io/health) · [`/v3/memory/marketplace`](https://13-229-63-192.sslip.io/v3/memory/marketplace) |
| **Networks** | Sui Testnet (memory + settlement) · Arbitrum Sepolia (FHE key vault) |
| **License** | MIT |

---

## The product, in one paragraph

OpenX is the **publish-and-earn marketplace** for AI agents. A seller curates knowledge once, publishes it as a brain, and any agent — Cursor, Claude Desktop, an autonomous worker — pays USDC per query and receives a TEE-attested answer. Sellers don't subscribe; buyers pay per-call via x402 / MPP / Sui-USDC. The product runs on two cryptographic pillars: **Sui** carries the on-chain memory market, and **Fhenix CoFHE on Arbitrum** wraps the symmetric key the buyer never sees.

---

## How it works

```
              Buyer agent (MCP / browser / API)
                          │
                          │  POST /v3/memory/brain/:id/query
                          │  x-payment-rail: sui_usdc | x402 | mpp
                          ▼
        ┌─────────── OpenX API ───────────┐
        │  auth → paymentGate → recall    │
        └────┬───────────┬────────────────┘
             │           │
   Sui Move tx     OpenXMemWalAdapter           Fhenix CoFHE (Arbitrum)
   (operator-                  │                          │
    signed)                    ├─→ MemWal (L1–L5 recall)  │  euint128 key
        │                      ├─→ Walrus (encrypted blob)│  unwrap-on-permit
        ▼                      └─→ Phala TEE (attested)   │
PaidQueryRecorded                                         ▼
SettlementBatchEmitted                          BrainKeyVaultV2.unwrap()
                                                (only the seller can authorize)
```

Two pillars carry the trust:

### 1 · Memory market on Sui

[MemWal](https://docs.wal.app) is Mysten Labs' L1–L5 cognitive-memory primitive. It can `remember`, `recall`, `analyze`, and `restore` text into a per-namespace memory account. OpenX wraps MemWal with what it lacks on its own: **payments, ownership, and a marketplace**.

A seller calls `publish_brain` on the OpenX Move package. The Move call mints a `MemWalBrain` shared object that pins:
- a **Walrus blob id** — the encrypted brain payload,
- a **MemWal namespace** — where L1–L5 facts live,
- a **price** in USDC, and
- a **subscription policy** (free / paid / KYA-gated).

Buyers hit `/v3/memory/brain/:id/query`. The API proves payment, calls MemWal `recall` through the operator pool, returns the answer with a three-proof receipt (Sui tx + Walrus blob id + Phala attestation), and emits `PaidQueryRecorded`. Settlement is batched every 60s.

### 2 · Privacy on Fhenix (Arbitrum)

The seller AES-256-GCM-encrypts knowledge in the browser. The 128-bit symmetric key is wrapped as a Fhenix CoFHE `euint128` and stored in [`BrainKeyVaultV2`](https://sepolia.arbiscan.io/address/0x9a6BcBea6De59FE19d7d1648EFb3F1Ee36331156). The unwrap requires an on-chain permit signed by the seller's wallet — even the OpenX server cannot decrypt without buyer payment + seller-authorized permit + TEE attestation. The brain's metadata is registered in [`KnowledgeBaseRegistryV2`](https://sepolia.arbiscan.io/address/0x97878Cb32C6c8A56e0604218C41C683a94CD075e); buyer activations and refunds clear through [`SubscriptionControllerV2`](https://sepolia.arbiscan.io/address/0x648d6b39360A53f604f9e808721eB7d780AabcA3).

The single supported entry point into MemWal is `packages/sdk/src/memwal/adapter.ts`. SOLID by construction: SRP (one class), DIP (Redis, payment gate, FHE envelope, logger all constructor-injected), OCP (extend `POINT_COSTS` + add a public method), and G4 isolation (`@mysten-incubation/memwal` is loaded only when `MEMWAL_PEERDEP_ENABLED=true`).

---

## Proof of work — both chains, both real

Everything below is on-chain, queryable from any browser.

### Sui testnet — memory market

| Artifact | Id / digest | Explorer |
|---|---|---|
| OpenX Move package | `0x4a760f6c982fbbe814dadb11adfe1a6c6d50bcce156de578b5f33e442f0e2041` | [Suiscan](https://suiscan.xyz/testnet/object/0x4a760f6c982fbbe814dadb11adfe1a6c6d50bcce156de578b5f33e442f0e2041) |
| Deploy tx | `3ScQEmpxmBmv3U8vUqL9ip73J771rSTK21mfdrt61hjz` | [Suiscan](https://suiscan.xyz/testnet/tx/3ScQEmpxmBmv3U8vUqL9ip73J771rSTK21mfdrt61hjz) |
| Sample `MemWalBrain` (price $0.05/query) | `0x728e0a23f573b9f2c837e959064c643aba0a9fc6b9c11fb300f01d26334e35ea` | [Suiscan](https://suiscan.xyz/testnet/object/0x728e0a23f573b9f2c837e959064c643aba0a9fc6b9c11fb300f01d26334e35ea) |
| Publish tx | `A1twpRRaACTwn1rjQV6PgRtqGGcPFWR6SaUuuaCizt4m` | [Suiscan](https://suiscan.xyz/testnet/tx/A1twpRRaACTwn1rjQV6PgRtqGGcPFWR6SaUuuaCizt4m) |
| Operator wallet | `0x7b9a9e7b878863cc14adcf2f3ff29094454d3b1fe78d00637cb81dc29ce7ce96` | [Suiscan](https://suiscan.xyz/testnet/address/0x7b9a9e7b878863cc14adcf2f3ff29094454d3b1fe78d00637cb81dc29ce7ce96) |
| Upstream MemWal package (Mysten) | `0xcf6ad755a1cdff7217865c796778fabe5aa399cb0cf2eba986f4b582047229c6` | [Suiscan](https://suiscan.xyz/testnet/object/0xcf6ad755a1cdff7217865c796778fabe5aa399cb0cf2eba986f4b582047229c6) |

The OpenX Move package contains 11 modules: `openx_memwal_marketplace`, `openx_memwal_billing`, `openx_memwal_revenue_split`, `brain_registry`, `subscription_policy`, `workflow`, `skill`, `reflective`, `agent_billing`, `agent_module`, `kya_gate`. **43/43 Move tests pass.**

### Arbitrum Sepolia — Fhenix CoFHE privacy layer

| Contract | Address | Explorer |
|---|---|---|
| `BrainKeyVaultV2` (FHE-wrapped key vault) | `0x9a6BcBea6De59FE19d7d1648EFb3F1Ee36331156` | [Arbiscan](https://sepolia.arbiscan.io/address/0x9a6BcBea6De59FE19d7d1648EFb3F1Ee36331156) |
| `KnowledgeBaseRegistryV2` (per-brain metadata) | `0x97878Cb32C6c8A56e0604218C41C683a94CD075e` | [Arbiscan](https://sepolia.arbiscan.io/address/0x97878Cb32C6c8A56e0604218C41C683a94CD075e) |
| `SubscriptionControllerV2` (buyer activations) | `0x648d6b39360A53f604f9e808721eB7d780AabcA3` | [Arbiscan](https://sepolia.arbiscan.io/address/0x648d6b39360A53f604f9e808721eB7d780AabcA3) |
| Sample agent registration tx | `0xc263f9cfd382a4c2fcf17ff655b2e47e0425d2a3903ce2811959f51dd3bd7a21` | [Arbiscan](https://sepolia.arbiscan.io/tx/0xc263f9cfd382a4c2fcf17ff655b2e47e0425d2a3903ce2811959f51dd3bd7a21) |
| Sample agent assignment tx | `0x1c6281b2567dd327c770686ce6e102cc0b98572df0df5136d5451e710dd5b36a` | [Arbiscan](https://sepolia.arbiscan.io/tx/0x1c6281b2567dd327c770686ce6e102cc0b98572df0df5136d5451e710dd5b36a) |

### Verify it yourself, no install needed

```bash
curl https://13-229-63-192.sslip.io/health
curl https://13-229-63-192.sslip.io/v3/memory/marketplace
curl https://13-229-63-192.sslip.io/api/v1/sui-audit-1780681145/.well-known/agent.json

# Fhenix permit gate — V2-aligned 2026-06-06.
# Was returning rpc_error before the fix because the on-chain probe
# called the V1 ABI (isAuthorized) on a V2 vault (uses hasAccess).
curl "https://13-229-63-192.sslip.io/permit/status?address=0x100690a32B562fd45e685BC2E63bbfF566d452db&refresh=1"
# → {"authorized":true,"reason":"onchain_authorized"}
```

---

## Run it locally

Requires Node 20+, Postgres 14+, and a wallet on either chain.

```bash
git clone https://github.com/phamdat721701/privacy-context.git openx
cd openx
npm install
cp .env.example .env.local        # set DATABASE_URL + PRIVY_APP_ID
npm run dev                       # API :3001 + frontend :3000
```

Then open http://localhost:3000 and pick a tier:

- **Standard tier — Fhenix on Arbitrum.** Sign in with Privy, switch to Arbitrum Sepolia, publish a brain at `/brain`. The flow encrypts in-browser, wraps the key as a Fhenix `euint128`, and registers the brain in `KnowledgeBaseRegistryV2`.
- **Trustless tier — Sui Testnet.** Connect a Sui wallet (Slush / Suiet / OKX-Sui), publish at `/brain-sui/new`. The flow writes the encrypted blob to Walrus, registers the namespace on MemWal, and mints a `MemWalBrain` shared object.

Run all smoke tests offline (43 Move + cognitive + workflow + walrus + memwal-adapter):

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

The 7-step DAG runs in <90s, costs ~$1.50 testnet-USDC, and streams a per-step receipt with Walrus blob ids + Phala attestations + Sui tx digests + Arbitrum permit hashes.

---

## Repo layout

```
packages/
├── api/             Express API · /v2 opaque · /v3 agentic · /v4 freemium (planned)
├── frontend/        Next.js 14 · landing, brain (Fhenix), brain-sui, marketplace, studio, chat
├── sdk/             schemas, cognitive memory, memwal adapter, FHE permit helpers
├── sui-sdk/         Sui · Walrus · Seal · Phala TEE clients
├── sui-contracts/   Move package — 43 tests
├── contracts/       Solidity v2 — BrainKeyVaultV2, KnowledgeBaseRegistryV2, SubscriptionControllerV2
└── runtime-utils/   resilientCall + circuit breaker + HMAC

scripts/
├── start-dev.sh                  full-stack one-command runner
├── seed-tri-marketplace.ts       seed live marketplace
├── setup-memwal-delegate.ts      register operator delegate keys (Sui side)
└── smoke-*.ts                    auth, walrus, memwal-adapter, fhenix-onboard, marketing-workflow…

docs/
├── PROJECT_CONTEXT.md   engineering snapshot (start here)
├── USP_BRIEF.md         product north star
└── SECURITY.md          threat model
```

Build orchestration is `npm workspaces`. **Each package owns its own dep build chain**, so any package builds standalone:

```bash
npm run build              # runtime-utils → sdk → ui → sui-sdk → openx-mcp → api
npm run sdk:build          # standalone — auto-builds runtime-utils first
npm run frontend:build     # standalone — auto-builds runtime-utils + sdk + sui-sdk + ui
```

---

## Tech stack

| Layer | Tool | Role |
|---|---|---|
| **Memory market** | Sui Move + MemWal + Walrus | `MemWalBrain` shared objects, L1–L5 cognitive recall, encrypted blob payload |
| **Privacy / key custody** | Fhenix CoFHE on Arbitrum | `euint128`-wrapped AES key, on-chain permit lifecycle, server cannot decrypt |
| **Inference** | Phala TEE (Confidential AI) | Attested answer hash; Bedrock Claude as fallback |
| **Settlement** | x402 · MPP · Sui-USDC · Stellar · XRPL · FHERC20 | Single `payRouter.ts` abstraction across rails |
| **Frontend** | Next.js 14 · Privy · wagmi · Sui dapp-kit | One UI, two ecosystems, EVM + Sui wallets side-by-side |
| **API** | Express + TypeScript + Pino | `/v2` opaque, `/v3` agentic, `/v4` freemium |
| **Observability** | Pino + prom-client + `/health` + correlation IDs | Structured logs, no `console.log` in `packages/api` |

---

## License

MIT. © Pham Nim ([@phamdat721701](https://github.com/phamdat721701)) — solo build: Move contracts, Solidity contracts, SDK, API, frontend.

*Privacy is the architecture. Memory is the inventory. Earnings are the artifact.*
