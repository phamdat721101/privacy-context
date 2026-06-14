# OpenX — the AI Assistant Marketplace

> **Hire AI assistants. Pay per task. Your data stays private.**
>
> Creators publish AI assistants once and earn instantly when anyone uses them. Buyers describe what they need, pay $0.50–$5 per task, and get the result in 30–60 seconds. The platform is cryptographically blind to both the creator's knowledge and the user's question.

| | |
|---|---|
| **Live API** | https://13-229-63-192.sslip.io · [`/health`](https://13-229-63-192.sslip.io/health) · [`/v3/marketplace/listings`](https://13-229-63-192.sslip.io/v3/marketplace/listings) |
| **Network** | Arbitrum Sepolia (`chainId 421614`) — mainnet flip after staging soak |
| **Settlement** | USDC on Arbitrum (testnet [`0x75faf1…AA4d`](https://sepolia.arbiscan.io/token/0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d)) |
| **License** | MIT |

---

## What it does

A user types `translate this NDA to Vietnamese` into the chat box. They drop the PDF, click **Pay $1.50**, sign once with their email-login Privy wallet, and get the translated PDF back ~30–60 seconds later. On-chain, USDC moves three ways in a single transaction — to the creator (70%), to the compute provider (25%), and to the platform (5%).

That's the **lighthouse demo**: the EN→VI Legal Document Translator. The same primitive runs every other assistant in the marketplace — research helpers, contract auditors, knowledge-pack Q&A, custom personas. Same flow: type → pay → result.

---

## Why it's different

Most AI tooling makes you choose between *you control your data* and *anyone can use it*. OpenX gives you both:

- **Knowledge stays encrypted client-side.** AES-256-GCM in your browser; the platform never reads it. The encryption key is wrapped on-chain via Fhenix CoFHE — only paid users can read answers, and only after a permit you control.
- **Inference runs in a Phala TEE.** Attested at runtime. Your question never lands on a logged server.
- **Payments are instant.** USDC on Arbitrum settles in the same block as the answer is delivered — creators don't wait, buyers don't pre-pay.

---

## How it fits together

```
              User (signs in with email via Privy → embedded wallet)
                                     │
                                     │ HTTPS
                                     ▼
              ┌─ OpenX API (Express + TypeScript + Pino) ──────────┐
              │  POST /api/v1/<slug>           (paywall — x402)    │
              │  POST /v3/marketplace/seller/publish (auth)        │
              │  GET  /v3/marketplace/listings (public)            │
              │  POST /v3/discover (public concierge ranking)      │
              │  paymentGate · paidCallLedger · fherc20Verifier    │
              └─────┬──────────────────────────────────┬───────────┘
                    │                                  │
            Supabase Postgres                  Supabase Storage
            (agents · brains · paid_calls      (AES-256-GCM ciphertext blobs)
             · sellers · cognitive_workflows)
                    │                                  │
                    └────────────────┬─────────────────┘
                                     ▼
                  Arbitrum Sepolia · Fhenix CoFHE
                  BrainKeyVaultV2 · KnowledgeBaseRegistryV2
                  SubscriptionControllerV2 · USDC · permits
```

---

## Try it in 30 seconds (no install)

```bash
# 1. Browse the live marketplace.
curl https://13-229-63-192.sslip.io/v3/marketplace/listings | jq '.listings[0:3]'

# 2. Concierge — describe what you need; get LLM-ranked assistants.
curl -X POST https://13-229-63-192.sslip.io/v3/discover \
  -H 'content-type: application/json' \
  -d '{"message":"translate this NDA to vietnamese"}' | jq '.candidates[0]'

# 3. Hit the translator paywall — returns 402 with a payment challenge.
curl -i https://13-229-63-192.sslip.io/api/v1/translator-en-vi
```

The full pay-and-receive flow needs a wallet to sign EIP-3009; the [SDK](packages/sdk) ships an x402 helper for both browser and Node.

---

## Run it locally

Requires Node 20+, Supabase Postgres + Storage, and a wallet on Arbitrum Sepolia funded with test USDC.

```bash
git clone https://github.com/phamdat721701/privacy-context.git openx
cd openx
npm install

# 1. Provision Supabase (see docs/runbooks/SUPABASE_MIGRATION.md), then:
cp .env.example .env.local
# Fill DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PRIVY_APP_ID

# 2. Apply migrations (idempotent)
npm run db:migrate

# 3. Run all services (API :3001, frontend :3000)
npm run dev
```

Then on http://localhost:3000:

- **Buyer** — type a task in the chat box on `/`. Concierge picks an assistant, you sign once with your email-Privy wallet, the result decrypts in your browser.
- **Creator** — publish at `/seller/onboard`. One-question wizard, persona prompt + price, sign one EIP-712 message — relayer pays gas. Earnings stream to your wallet on every use.
- **Studio** — `/studio` is your management dashboard. Lists every assistant you own, with per-call earnings inline.

Run all offline regression checks:

```bash
bash scripts/run-all-smokes.sh
```

Seed the EN→VI translator lighthouse (against your local API):

```bash
PHAM_WALLET_ADDRESS=0x… npm run seed:translator
API_URL=http://localhost:3001 npm run smoke:translator-e2e
```

---

## Repo layout

```
packages/
├── api/             Express API · /v3 marketplace · /api/v1 paywall
├── frontend/        Next.js 14 · landing, marketplace, seller/onboard, studio
├── sdk/             schemas, cognitive memory, FHE permit helpers, MCP server
├── contracts/       Solidity v2 — BrainKeyVaultV2, KnowledgeBaseRegistryV2
└── runtime-utils/   resilientCall + circuit breaker + HMAC

scripts/
├── start-dev.sh                  full-stack one-command runner
├── seed-translator-agent.ts      seed the EN→VI lighthouse
├── smoke-translator-e2e.ts       end-to-end demo flow
├── migrate-to-supabase.ts        one-shot data copy
└── run-all-smokes.sh             offline regression gate

docs/
├── PROJECT_CONTEXT.md            engineering snapshot
├── USP_BRIEF.md                  product north star
└── runbooks/SUPABASE_MIGRATION.md  T1+T2 ops doc
```

`npm workspaces`-managed. Each package builds standalone.

---

## What's encrypted

- **Brain payloads** — AES-256-GCM in the browser, ciphertext stored in Supabase (or, for migrated rows, the existing Postgres `knowledge_chunks` table). The platform never sees plaintext.
- **AES key** — wrapped as a Fhenix `euint128` on-chain in `BrainKeyVaultV2`. Unwrap requires an on-chain permit signed by the creator.
- **Payment** — USDC settles on Arbitrum. A confidential variant (Fhenix `euint64` via `WrappedStablecoin.encryptedTransfer`) is opt-in via the `accept_private_payment` flag.

The only off-chain trust assumptions are: Arbitrum sequencer + Circle USDC + Fhenix's threshold gateway.

---

## Tech stack

| Layer | Tool | Role |
|---|---|---|
| **Privacy / key custody** | Fhenix CoFHE on Arbitrum | `euint128`-wrapped AES key, on-chain permit lifecycle |
| **Inference** | Phala TEE (primary) / Bedrock Claude (fallback) | Attested answer hash |
| **Settlement** | x402 · MPP · FHERC20 | Single `payRouter.ts` abstraction |
| **Storage** | Supabase Postgres + Storage | Database + encrypted blob hosting |
| **Frontend** | Next.js 14 · Privy · wagmi | Email-login → embedded wallet → sign once |
| **API** | Express + TypeScript + Pino | `/v3` marketplace · `/api/v1` paywall |
| **Observability** | Pino + prom-client + `/health` | Structured logs, no `console.log` in `packages/api` |

---

## License

MIT. © Pham Nim ([@phamdat721701](https://github.com/phamdat721701)) — solo build: Solidity contracts, SDK, API, frontend, deploy infra.

*Privacy is the architecture. Per-task is the business model. Earnings are the artifact.*
