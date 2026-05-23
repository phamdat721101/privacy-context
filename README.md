# Fhedin · FHE Second Brain

**Get paid when AI agents query your brain.**

Fhedin is the marketplace where AI agents pay you in USDC to read knowledge only you control — and the platform is cryptographically blind to both sides of the transaction. Powered by Fhenix CoFHE on Arbitrum, ERC-8004 agent identity, and Phala TEE-attested inference.

> **Patreon for AI agents.** Sellers publish encrypted brains; agents pay per query in USDC; the platform cannot read the knowledge.

🔗 **Live API**: https://13-229-63-192.sslip.io · `/openapi.json`
🔗 **Contracts (Arbitrum Sepolia, v2)**:
- [`SubscriptionControllerV2`](https://sepolia.arbiscan.io/address/0x648d6b39360A53f604f9e808721eB7d780AabcA3) — `0x648d6b39360A53f604f9e808721eB7d780AabcA3`
- [`KnowledgeBaseRegistryV2`](https://sepolia.arbiscan.io/address/0x97878Cb32C6c8A56e0604218C41C683a94CD075e) — `0x97878Cb32C6c8A56e0604218C41C683a94CD075e`
- [`BrainKeyVaultV2`](https://sepolia.arbiscan.io/address/0x9a6BcBea6De59FE19d7d1648EFb3F1Ee36331156) — `0x9a6BcBea6De59FE19d7d1648EFb3F1Ee36331156`

> 📄 Read [`docs/USP_BRIEF.md`](docs/USP_BRIEF.md) before touching `/`, copy, marketing, or pricing.

---

## The 60-second flow

```
0s    Land on /                "Get paid when AI agents query your brain."
                               Single CTA: "Publish your first note"
5s    1-click sign-in          Privy embedded wallet
15s   Type a sentence          "I built a Solidity FHE contract on Arbitrum…"
20s   Click Publish            Atomic: AES-encrypt → on-chain key → opaque upload
25s   Brain card live          $0.01 / query in the marketplace
30s   First agent query        Seeded Demo Agent fires within ~30s of publish
35s   You see ✅ +$0.01 USDC   from agent 0xA1F2…  (TEE-attested answer)
60s   Tweet button             Pre-filled: "I'm now charging Claude $0.01 every time…"
```

This replaces the old four-step "login → permit → upload → chat" flow. The magic verb is **earn**, not *store*.

---

## Why this is 10× over Granola / Notion AI / mem.ai

| Incumbent | Pain | Fhedin's 10× |
|---|---|---|
| Granola ($1.5B, plaintext) | You pay $38/seat | You earn — economic model is inverted |
| Notion AI / OpenAI Memory | Sam Altman's team can read your notes | We literally cannot — AES key never leaves your browser |
| Pinecone + Postgres self-host | Maintenance burden, no enterprise pitch | One-line SDK, FHE-encrypted by default, on-chain ownership proof |
| Phala alone | TEE for inference, no encrypted memory | We use Phala for inference + Fhenix for memory — full stack |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ FRONTEND (Next.js 14)                                        │
│  /            USP hero + featured brains                     │
│  /publish     One-click encrypt + on-chain key + publish     │
│  /earnings    Live x402 settlements per brain                │
│  /marketplace Browse + ask                                   │
└────────────────────────┬─────────────────────────────────────┘
                         │  HTTPS · x-wallet-address · x-erc8004-agent-id
┌────────────────────────▼─────────────────────────────────────┐
│ API (Express)                                                │
│  /v2/upload      Atomic publish (encrypt → on-chain → DB)    │
│  /v2/inference   Phala TEE answer + attestation              │
│  /brains/earnings/{wallet}  Real-time seller earnings        │
│  /openapi.json   Self-describing for AI agents               │
│                                                              │
│  middleware/agent-kya.ts  ERC-8004 viem read                 │
│  services/demo-agent.ts   Seeds the first earning event      │
└──────────┬────────────────────┬─────────────────┬────────────┘
           ▼                    ▼                 ▼
   ┌──────────────┐    ┌────────────────┐  ┌──────────────────┐
   │ Supabase     │    │ Fhenix CoFHE   │  │ Phala TEE        │
   │ opaque       │    │ Arbitrum       │  │ Confidential AI  │
   │ ciphertext   │    │ BrainKeyVaultV2│  │ (env-flag swap)  │
   └──────────────┘    └────────────────┘  └──────────────────┘
```

The privacy guarantee:

- Content is AES-256-GCM encrypted **in the user's browser**.
- The 256-bit key is split into two `euint128` halves, FHE-wrapped via `@cofhe/sdk/web`, and stored in `BrainKeyVaultV2`.
- The platform receives only opaque ciphertext + an on-chain transaction hash.
- Decryption uses Fhenix's threshold network (gasless for the user); the platform itself never holds the AES key.

---

## Live API endpoints (most useful subset)

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/openapi.json` | GET | Public | **Agent entry point** — declares prices, KYA, attestation per op |
| `/health` | GET | Public | Service status |
| `/brains` | GET | Public | List published brains |
| `/brains/{id}` | GET | Public | Brain detail |
| `/brains/earnings/{wallet}` | GET | Self-only | Real-time earnings + receipts |
| `/v2/upload` | POST | Wallet | Atomic encrypted publish |
| `/v2/brains/{id}/chunks` | GET | Wallet | Opaque ciphertext fetch |
| `/v2/inference` | POST | Wallet (+ optional KYA) | TEE-attested answer |

Agent-discovery extensions on every operation:

- `x-price-usdc` — per-query price (e.g. `"0.01"`)
- `x-kya-required` — boolean; whether ERC-8004 identity is needed
- `x-attestation-providers` — `["phala-tee", "fhenix-tn"]`
- `x-actor` — `seller` / `agent-or-human` / `human`

---

## 🆕 Arkiv Memory Tier (Web3 Database Builder Challenge)

Submission to the **Network School × Arkiv "Web3 Database Builder Challenge"**
($3,000 USDC pool · one-week build · free month at NS).

**Theme:** AI + Privacy hybrid. Per the [builders-guide](https://github.com/Arkiv-Network/arkiv-ethns-builder-challenge/blob/main/docs/builders-guide.md) — agents own their memory (AI theme: queryable per-wallet `agent-memory` + immutable `agent-decision` reputation log) and we apply a selective AES-256-GCM envelope to confidential entries with auto-revoke via `expiresIn` (Privacy theme). Project attribute: `fhedin-ethns-2c4f9a`.

A third tier — **Memory** — runs alongside the existing Standard (Fhenix) and
Trustless (Sui) tiers. v2 routes are untouched; the new code is fully additive.

```
Memory-Agent v1 cycle (per buyer query)
   ┌────────────────────────────────────────┐
   │ 1. read prior facts on (agentId,topic) │  createPublicClient (Arkiv-Braga)
   │ 2. cache-hit ?                         │      .where + .createdBy filter
   │      → refine answer (cheaper)         │      Best Practice #12
   │      else → query brain (existing v3)  │
   │ 3. sign LearnedFact                    │  viem.signMessage (EIP-191)
   │ 4. POST /v4/memory                     │  walletClient.createEntity
   │      expiresIn = 30d                   │  TTL is the market mechanic
   └────────────────────────────────────────┘
```

What's new:

- **`/v4/memory/*`** — REST surface for write/read/find/extend (mounted
  parallel to v2 + v3; no existing routes touched).
- **`packages/sdk/src/memory`** — typed `LearnedFact` schema, deterministic
  canonical-JSON signing, signature-recovery on read, optional AES envelope.
- **`/memory` page** — live feed via `subscribeEntityEvents` (poll 2s),
  TTL countdowns, "Extend +30d · $0.01" CTA → x402.
- **🛡️ verify-on-arkiv panel** — global floating button → twin iframes
  (Arkiv block explorer + `data.arkiv.network`) so anyone verifies without
  trusting Fhedin's database.
- **`scripts/demo-arkiv-memory-market.ts`** — replayable end-to-end demo
  with colored scoreboard.

Quick start for the Arkiv tier:

```bash
# 1. Install Arkiv's official Agent Skills (mirrors the rubric exactly).
npx skills add https://github.com/Arkiv-Network/skills --all

# 2. Mint fresh wallets (the previously-leaked 0xc954… key is decommissioned).
npm run gen:demo-wallets       # writes .env.local (chmod 600); never logs secrets

# 3. Fund them on Braga (GLM gas), Arbitrum Sepolia (ETH), Base (USDC).
#    Faucet: https://braga.hoodi.arkiv.network/faucet/

# 4. Roundtrip smoke test against Braga.
ARKIV_LIVE=1 npm run smoke:arkiv

# 5. Boot api with the Memory-Agent enabled, then run the demo.
MEMORY_AGENT_ENABLED=true npm run api:dev   # in one terminal
npm run demo:arkiv-memory-market            # in another → colored scoreboard
```

Read the full integration brief: [`docs/ARKIV_INTEGRATION.md`](docs/ARKIV_INTEGRATION.md).

---

## Quick start

```bash
git clone https://github.com/phamdat721701/privacy-context.git
cd privacy-context
npm install
npm run build
cd packages/api && cp ../../.env.example .env  # set DATABASE_URL + BEDROCK_API_KEY
npm run dev
# In another terminal:
npm run frontend:dev
# Open http://localhost:3000
```

### Optional production env (drop into `packages/api/.env`)

```bash
# Phala Confidential AI (TEE-attested answers)
PHALA_ENDPOINT=https://api.red-pill.ai
PHALA_API_KEY=...
PHALA_MODEL=gpt-4o-mini

# ERC-8004 agent identity (Base mainnet by default)
ERC8004_RPC_URL=https://base-mainnet.public.blastapi.io
ERC8004_REGISTRY_ADDRESS=0x...

# Seeded demo agent (set false in real prod)
DEMO_AGENT_ENABLED=true
DEMO_AGENT_INTERVAL_MS=10000
```

---

## SDK usage (for AI agents)

```typescript
import { createBrainClient } from '@fhe-ai-context/sdk';

const brain = createBrainClient('fhenix', {
  apiUrl: 'https://api.fhedin.example',
  walletAddress: '0xYourAgent',
  // Optional: pass your ERC-8004 identity for KYA-gated brains
  erc8004AgentId: '12345',
});

// Publish a brain (sellers)
const r = await brain.publishBrain('I know FHE patterns on Arbitrum.', {
  title: 'Fhenix CoFHE 101',
  tags: ['fhe', 'fhenix', 'solidity'],
});
console.log('brainId:', r.brainId);

// Ask a brain (agents)
const ans = await brain.chat('What is the simplest FHE pattern for a private balance?', String(r.brainId));
console.log(ans.response);
console.log(ans.attestation); // { provider: 'phala-tee', verified: true, hash: '...' }
```

---

## Project structure

```
docs/
├── USP_BRIEF.md          ← read first; the product north star
├── UNIFIED_FLOW_SPEC.md  ← human + agent surfaces
├── UX_AUDIT.md           ← Gstack-style audit
├── PROJECT_CONTEXT.md    ← this snapshot, dated
├── MASTER_PROPOSAL.md    ← v1.0 grant packet (slightly older framing)
└── research/             ← PHASE1-REPORT.md baseline competitive analysis

packages/
├── api/        Express; Bedrock | Phala swap; ERC-8004 middleware; demo-agent service
├── frontend/   Next.js 14; /publish + /earnings are the new core flows
├── ui/         Design system: tokens, primitives, molecules (PriceChip, EarningsReceipt, AttestationBadge, AgentIdBadge)
├── contracts/  Solidity v2 (BrainKeyVaultV2, KnowledgeBaseRegistryV2, SubscriptionControllerV2)
├── sdk/        TS SDK (createBrainClient + agent helpers)
├── runtime-utils/ resilientCall + HMAC resume tokens
├── shared/     types, DB config, contract ABIs
└── (sui-sdk/sui-contracts/agent/worker/zama-contracts: parked, see docs)
```

---

## 30-day kill criteria (the launch experiment)

Per `docs/USP_BRIEF.md`. After public launch, evaluate:

| Metric | Pass | Fail |
|---|---|---|
| Distinct seller wallets that publish ≥1 brain | ≥100 | <30 |
| Brains earning revenue from ≥3 distinct agent wallets | ≥5 | 0 |
| Distinct agent wallets paying for queries | ≥20 | <5 |
| Unsolicited tweet from a recognizable crypto-AI account | ≥1 | none |
| Total settled USDC (testnet OK) | ≥$50 | <$5 |

**Pass** → scale (Phala mainnet, deeper ERC-8004, grants).
**Fail** → pivot to candidate #2 from the Gstack analysis ("cryptographic amnesia for journalists/lawyers/therapists").

---

## License

MIT.

*Privacy is not a feature — it's the architecture.*
