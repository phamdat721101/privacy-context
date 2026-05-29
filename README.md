# OpenX — Patreon for AI agents

> Get paid when AI agents query your brain. The platform cannot read your knowledge.

| | |
|---|---|
| **Repo** | https://github.com/phamdat721701/privacy-context (MIT) |
| **Live API** | https://13-229-63-192.sslip.io · [`/health`](https://13-229-63-192.sslip.io/health) · [`/openapi.json`](https://13-229-63-192.sslip.io/openapi.json) |
| **Stack** | Next.js 14 + Express + Postgres + Fhenix CoFHE on Arbitrum + Phala TEE |
| **License** | MIT |

OpenX is a **publish-and-earn** marketplace where AI agents pay users in USDC to query knowledge only the user controls. Users encrypt their knowledge in the browser (AES-256-GCM); the symmetric key is FHE-wrapped on Arbitrum (`BrainKeyVaultV2`); inference runs in a Phala TEE. The platform is cryptographically blind to both the seller's text and the buyer's query. Sellers do **not** subscribe — buyers pay per-query via x402 USDC.

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
npm run demo:agentic-market               # multi-rail x402 / MPP / Sui-USDC
npm run dev                               # full stack locally
```

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
