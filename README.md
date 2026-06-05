# OpenX — Cognitive Memory Marketplace on Sui

> **OpenX is the only cognitive memory marketplace on Sui** — a place where agents publish their brains, sell their skills, and license their workflows for USDC, with Phala-TEE-attested execution, multi-rail buyer payments, and KYA-credentialed Move-policy access. **Walrus Memory remembers. OpenX monetizes the remembering.**

| | |
|---|---|
| **Repo** | https://github.com/phamdat721701/privacy-context (MIT) |
| **Live API** | https://13-229-63-192.sslip.io · [`/health`](https://13-229-63-192.sslip.io/health) · [`/openapi.json`](https://13-229-63-192.sslip.io/openapi.json) · [`/v3/dashboard/stats`](https://13-229-63-192.sslip.io/v3/dashboard/stats) |
| **Stack** | Next.js 14 + Express + Postgres + Sui Testnet (Walrus + Seal + Move) + Fhenix CoFHE on Arbitrum + Phala TEE |
| **License** | MIT |

OpenX is the commercial overlay Walrus Memory architecturally cannot ship without rewriting itself: a tri-marketplace for **skills + brains + workflows**, with deterministic L1→L5 cognitive promotion, Phala TEE encryption-during-compute, multi-rail USDC payments, KYA-gated Move policy, and a sovereignty-proof endpoint. Sellers don't subscribe; buyers pay per-call / per-query / per-execution / per-license.

## 6-anchor pitch matrix

| # | Anchor | Concrete proof |
|---|---|---|
| 1 | **Tri-marketplace** (skills + brains + workflows + reflective traces, one Move-object pattern) | `openx.so/marketplace?type=skill\|brain\|workflow\|reflective` filterable; ≥1 of each type live testnet |
| 2 | **Cognitive memory L1→L5** (episodic→semantic→procedural→workflow→reflective) | `cognitiveMemoryService.ts` with `promoteToWorkflow` + `promoteToReflective` deterministic + signed |
| 3 | **Encryption-during-compute** (Phala TEE + Seal threshold) | Phala attestation hash returned per step; `seal_approve_*` Move targets per product |
| 4 | **Multi-rail PayRouter** | x402 + MPP + Sui-USDC + Stellar + XRPL + FHERC20 — one `Pay()` abstraction |
| 5 | **KYA-gated Move policy** (ERC-8004 reputation reads in Move) | `seal_approve_pay_per_call/workflow_run/skill_call/license_unlock` + 60-sec freshness window |
| 6 | **Sovereignty proof** | `/v3/workflows/:id/sovereignty-proof` rebuilds from Walrus alone — the OpenX DB is not in the trust path |

## Network isolation guarantees

The Sui pivot does **not** affect Standard tier (Fhenix on Arbitrum) or any of the multi-rail payment paths:

| Guarantee | How enforced |
|---|---|
| G1 — UX clarity | Sui-only product cards in marketplace surface a `SwitchToSuiPrompt` for Standard-tier wallets |
| G2 — server-side guard | `requireSuiWallet` middleware on POST publish + execute; `WorkflowRunner` asserts `sui_object_id` non-empty |
| G3 — promotion guard | `promoteToWorkflow` filters bundles by `tier === 'trustless'` before emitting candidates |
| G4 — install isolation | `@mysten-incubation/memwal` is an **optional** peer-dependency; Standard-tier installs don't pull it; `WalrusMemoryBridge` constructor throws clear actionable errors when missing |
| G5 — regression suite | `scripts/run-all-smokes.sh` + `.github/workflows/regression.yml` runs 36 Move tests + 55 SDK smokes on every PR |

---

## Quick start (≤ 5 minutes from clean clone)

```bash
git clone https://github.com/phamdat721701/privacy-context.git
cd privacy-context
npm install
cp .env.example .env.local      # fill in DATABASE_URL, PRIVY_APP_ID, etc.
npm run dev                      # → http://localhost:3000
```

`npm run dev` is one command — it loads `.env`, builds the SDK, boots the api on `:3001`, then the frontend on `:3000`, and prints a banner. `Ctrl+C` tears both processes down.

## Verify the build (offline regression)

```bash
bash scripts/run-all-smokes.sh
# → builds 5 packages tsc green
# → runs Move tests (sui move test) — 36 cases
# → runs cognitive smoke           — 22 cases
# → runs workflow runner smoke     — 13 cases (G2 guard verified)
# → runs marketing-workflow smoke  — 18 cases (lighthouse 7-step DAG runs in <90s)
# → runs WalrusMemoryBridge smoke  — 2 cases (G4 guards verified)
# → seed-tri-marketplace DRY validation
```

## Live demo path (Sui testnet)

```bash
# 1. Seed the marketplace with bootstrap content (3 brains + 3 skills + 1 workflow)
API_URL=https://13-229-63-192.sslip.io \
PHAM_WALLET_ADDRESS=0x… \
PHAM_PRIVATE_KEY=0x… \
SEED_SUI_OBJECT_ID=0x…  SEED_WALRUS_BLOB_ID=walrus:… \
  npm run seed:tri-marketplace

# 2. Browse the marketplace
open https://your-frontend/marketplace?type=workflow

# 3. Run the lighthouse marketing-7-step workflow (90 seconds, $1.50 testnet-USDC)
#    Watch step-by-step receipts stream live + Phala attestations + Walrus blob ids.

# 4. Cash-flow proof — public, no auth required:
open https://your-frontend/dashboard
```

---

## What it is

A marketplace where **AI agents pay you in USDC to read knowledge only you control**. Three independent paths to the same data ("composability"):

1. **Web UI** — `/brain` (publish + manage), `/marketplace` (browse), `/studio` (wrap a brain as a paid agent).
2. **HTTP API** — `/v2/upload`, `/v2/inference`, `/brains*`, `/permit/*`. Agent-aware OpenAPI at `/openapi.json` (declares `x-price-usdc`, `x-kya-required`, `x-attestation-providers`).
3. **Direct on-chain** — read `BrainKeyVaultV2` on Arbitrum Sepolia for the FHE-wrapped key envelope; the platform is in the relay path, not the trust path.

---

## Architecture

```
                    ┌──────────── Frontend (Next.js 14) ────────────┐
                    │  /  /brain  /marketplace  /studio  /chat       │
                    │  Privy embedded wallet · MetaMask · wagmi      │
                    └───────────────┬────────────────┬───────────────┘
                                    │                │
                  encrypted ingest  │                │  paid query (x402 USDC)
                                    ▼                ▼
            ┌──────────── API (Express @ :3001) ──────────────────┐
            │  /v2  → opaque brain CRUD, encrypted chunks         │
            │  /v3  → dual-chain agentic marketplace              │
            │  /brains, /upload, /permit, /chat → legacy paths    │
            │  Pino structured logs · Prometheus /metrics         │
            └────────┬─────────────────────┬──────────────────────┘
                     │                     │
            BrainKeyVaultV2          Phala TEE inference
            (Arbitrum Sepolia,       (Confidential AI,
             Fhenix CoFHE)            attestation hash returned)
```

---

## Tech stack

| Layer | Tool | Why |
|---|---|---|
| Frontend | Next.js 14 (App Router) + Tailwind | Static-route home, app-shell with Brain / Marketplace / Studio tabs |
| Wallet | Privy embedded + MetaMask via EIP-1193 | One pattern for both — see `lib/networks.ts` |
| API | Express + TypeScript + Pino | Lightweight; v2/v3 routes structured per actor (seller / buyer / agent) |
| LLM | Phala TEE (Confidential AI) with Bedrock Claude fallback | Attested chat answers — see `services/chat.ts` |
| Encrypted brain | Fhenix CoFHE on Arbitrum Sepolia | Symmetric key FHE-wrapped on-chain; only the user's wallet can authorize decryption |
| SDK | TypeScript workspace `@fhe-ai-context/sdk` | Shared schema between server, frontend, demo scripts |
| Auth | Privy (humans), ERC-8004 (agents) | Email + embedded wallet for humans; KYA header for agents |
| Payments | x402 + USDC on Base Sepolia | Per-call paywall, no subscriptions for sellers |

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

## Run the demos

```bash
npm run smoke:auth                        # wallet auth + permit roundtrip
npm run smoke:chunks-auth                 # encrypted chunk auth
npm run smoke:sui-flow                    # Sui identity-binding roundtrip (NEW)
npm run demo:agentic-market               # multi-rail x402 / MPP / Sui-USDC
npm run dev                               # full stack locally
```

## Try Sui mode (trustless tier)

```bash
npm run dev                               # starts API + frontend
# 1. Open http://localhost:3000
# 2. Sign in with Privy (any email / EVM wallet works)
# 3. Click the network pill in the top bar → pick "Sui Testnet"
# 4. Click "Connect Sui" — Slush, Suiet, OKX, or Phantom-Sui all work
# 5. The pill turns purple; visit /brain-sui/new to publish a trustless brain
```

The active tier auto-derives from the network choice — selecting Sui flips the
publish flow to Walrus + Sui + Tatum visualization (`TrustlessProgressTimeline`
during publish, `TrustlessStatusPanel` on the brain detail page). The
backend EVM↔Sui binding (`POST /v3/identity/link`) runs once on the first Sui
wallet connect and is idempotent thereafter.

---

## Project structure

```
docs/
├── PROJECT_CONTEXT.md   ← engineering snapshot (start here)
├── USP_BRIEF.md         ← OpenX product north star
├── SECURITY.md          ← threat model + decommissioned keys
└── …                    other proposals/research

packages/
├── api/                  ← Express; /v2 + /v3 routes (brains, agents, earnings)
├── frontend/             ← Next.js 14; landing + brain + marketplace + studio
├── sdk/                  ← typed schemas + cognitive memory + canonical-JSON signing
├── ui/                   ← shared design tokens
├── runtime-utils/        ← resilientCall + HMAC helpers
├── shared/               ← types, DB config, contract ABIs
├── contracts/            ← Solidity v2 (BrainKeyVaultV2, KnowledgeBaseRegistryV2, SubscriptionControllerV2)
└── (sui-sdk/sui-contracts/agent/worker/zama-contracts: parked)

scripts/
├── start-dev.sh                   ← one-command full-stack runner
├── smoke-auth.ts                  ← auth roundtrip
├── smoke-chunks-auth.ts           ← encrypted chunk auth
└── demo-agentic-market.ts         ← v3 multi-rail demo
```

---

## Contracts (Arbitrum Sepolia)

- [`SubscriptionControllerV2`](https://sepolia.arbiscan.io/address/0x648d6b39360A53f604f9e808721eB7d780AabcA3)
- [`KnowledgeBaseRegistryV2`](https://sepolia.arbiscan.io/address/0x97878Cb32C6c8A56e0604218C41C683a94CD075e)
- [`BrainKeyVaultV2`](https://sepolia.arbiscan.io/address/0x9a6BcBea6De59FE19d7d1648EFb3F1Ee36331156)

---

## Team

| Name | GitHub | Role |
|---|---|---|
| Pham Nim | [@phamdat721701](https://github.com/phamdat721701) | Solo / lead — design, contracts, SDK, API, frontend |

---

## License

MIT. See [`LICENSE`](LICENSE).

*Privacy is not a feature; it's the architecture. Earnings are not a promise; they're an artifact.*
