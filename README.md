# FHE AI Context Management

**Confidential AI Knowledge Management powered by Fhenix FHE**

Build your private AI second brain where knowledge is encrypted on-chain, ownership is cryptographically provable, and access is controlled by Fully Homomorphic Encryption — not database flags.

🔗 **Live API**: https://13-229-63-192.sslip.io
🔗 **Contracts**: Arbitrum Sepolia ([SubscriptionController](https://sepolia.arbiscan.io/address/0xCC42779858F1cd3F480aD33BcBc5A931D57DfFc3) | [KnowledgeBaseRegistry](https://sepolia.arbiscan.io/address/0x36eca600679E73061318f8C10F6E43aFc06C96E0) | [BrainKeyVault](https://sepolia.arbiscan.io/address/0x07beFe30F0C8Ef8B4c513da22A310eF84E9010c0))

---

## The Problem

AI assistants need access to your personal knowledge to be useful. But storing knowledge in plaintext means:
- The platform can read everything you store
- Data breaches expose your private notes
- You can't prove you own your knowledge
- You can't revoke access cryptographically

## The Solution

FHE Second Brain uses **Fhenix Fully Homomorphic Encryption** to solve all four problems:

```
Upload knowledge → AES-encrypt content → store on IPFS
                → FHE-encrypt the AES key → store on-chain (BrainKeyVault)
                → Only permitted parties can decrypt
                → Revoke permit = instant access revocation
```

**Your knowledge is yours. Provably. Cryptographically.**

---

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js)                         │
│  Connect Wallet → Authorize (FHE Permit) → Store/Learn/Share│
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS + x-wallet-address + permit
┌──────────────────────▼──────────────────────────────────────┐
│                    API SERVER (Express)                       │
│  Auth (permit check) → Subscription gate → Chat/Upload/Brains│
└──────────────────────┬──────────────────────────────────────┘
                       │
          ┌────────────┼────────────────┐
          ▼            ▼                ▼
┌──────────────┐ ┌──────────┐ ┌─────────────────┐
│   Supabase   │ │  Fhenix  │ │   Bedrock LLM   │
│  (Postgres)  │ │  CoFHE   │ │  (Claude Opus)  │
│  chunks,     │ │  on-chain│ │  RAG answers    │
│  history     │ │  keys,   │ │                 │
│              │ │  proofs  │ │                 │
└──────────────┘ └──────────┘ └─────────────────┘
```

### The Fhenix Layer (What Makes This Different)

| Contract | Purpose | FHE Types Used |
|----------|---------|----------------|
| **SubscriptionController** | Encrypted subscription state | `euint8` tier, `euint64` expiry, `ebool` active |
| **KnowledgeBaseRegistry** | Encrypted ownership proofs | `euint128` merkleRoot per brain |
| **BrainKeyVault** | Encrypted content decryption keys | `euint128` keyHigh + `euint128` keyLow |

### User Flow

```
1. CONNECT WALLET
   └→ Privy authenticates user

2. AUTHORIZE (FHE Permit)
   └→ User signs permit with wallet (proves ownership)
   └→ Permit sent to API (POST /permit/import)
   └→ Platform can now decrypt user's FHE-protected data
   └→ This IS the authentication — cryptographic, not a password

3. SUBSCRIBE (x402 Payment)
   └→ User pays via n-payment SDK (USDC on Base Sepolia)
   └→ SubscriptionController.subscribe() called on-chain
   └→ Encrypted tier/expiry stored (nobody sees who subscribed)

4. STORE KNOWLEDGE
   └→ Chat mode "store": type knowledge conversationally
   └→ File upload: bulk import .txt/.md/.csv
   └→ Content chunked and stored in Supabase
   └→ On-chain: KnowledgeBaseRegistry records encrypted Merkle root

5. LEARN FROM BRAIN
   └→ Chat mode "learn": ask questions
   └→ RAG: TF-IDF ranks relevant chunks
   └→ Claude Opus generates answer from YOUR knowledge only
   └→ Chat history maintained for continuity

6. PUBLISH & SHARE
   └→ Publish brain to catalog (requires FHE permit)
   └→ On-chain: KnowledgeBaseRegistry.publish()
   └→ Other subscribers can query your brain via AI
   └→ They get AI answers — never see raw chunks

7. REVOKE ACCESS
   └→ DELETE /permit/revoke
   └→ Platform loses decryption ability instantly
   └→ Cryptographic guarantee — not just a DB flag
```

---

## Why Fhenix is Essential (Not Optional)

| Without FHE | With Fhenix FHE |
|-------------|-----------------|
| Platform stores your keys in plaintext DB | Keys are `euint128` on-chain — platform needs `FHE.allow()` |
| "Revoke access" = flip a boolean | Revoke permit = cryptographic loss of decryption ability |
| "Prove ownership" = trust the platform | Encrypted Merkle root on-chain = verifiable without revealing content |
| "Private subscription" = hide in DB | `ebool active` + `euint8 tier` = nobody on-chain sees who subscribed |
| Admin can read everything | Admin without permit literally cannot decrypt |

**The key insight**: FHE makes access control **cryptographic** instead of **administrative**. The platform can't cheat even if it wanted to.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 + Tailwind + Privy (wallet auth) |
| Backend | Express.js (TypeScript) |
| Database | Supabase (Postgres) |
| LLM | AWS Bedrock Claude Opus (fallback: OpenAI) |
| Blockchain | Arbitrum Sepolia (Fhenix CoFHE) |
| Payment | n-payment SDK (x402 protocol) |
| Encryption | AES-256-GCM (content) + FHE euint128 (keys) |
| Deploy | VPS + Caddy (auto-SSL) |

---

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/health` | GET | Public | Service status |
| `/openapi.json` | GET | Public | API spec for agent discovery |
| `/brains` | GET | Public | Browse published brains |
| `/brains/search?q=` | GET | Public | Search brains |
| `/brains/:id` | GET | Public | Brain detail |
| `/permit/import` | POST | Wallet | Import FHE permit (authorize) |
| `/permit/revoke` | DELETE | Wallet | Revoke platform access |
| `/subscribe` | POST | Wallet | Pay subscription (x402) |
| `/chat` | POST | Subscription | Chat with brain (store/learn) |
| `/upload` | POST | Permit + Sub | Upload file to brain |
| `/brains/create` | POST | Permit | Create new brain |
| `/brains/publish` | POST | Permit | Publish brain to catalog |
| `/brains/mine` | GET | Wallet | List own brains |
| `/chat/history` | GET | Subscription | Chat history |

---

## Quick Start

### Prerequisites
- Node.js 20+
- Wallet with Arbitrum Sepolia ETH

### Local Development

```bash
git clone https://github.com/phamdat721101/privacy-context.git
cd privacy-context

# Setup
cp .env.example packages/api/.env
# Edit packages/api/.env with your DATABASE_URL (Supabase) and BEDROCK_API_KEY

# Build
npm install
npm run sdk:build
npm run api:build

# Run
cd packages/api && node dist/server.js
# API at http://localhost:3001

# Frontend (separate terminal)
npm run frontend:dev
# UI at http://localhost:3000
```

### Production Deploy (VPS)

```bash
./scripts/deploy.sh
# Deploys API via PM2 + Caddy auto-SSL
```

### Deploy Contracts

```bash
cd packages/contracts
PLATFORM_WALLET=0x... npx hardhat run scripts/deploy-brain-system.ts --network arbitrumSepolia
```

---

## SDK Usage (For AI Agents)

```typescript
import { createBrainClient } from '@fhe-ai-context/sdk';

const brain = createBrainClient('fhenix', {
  apiUrl: 'https://api.example.com',
  chain: 'arbitrum-sepolia',
  walletAddress: '0xYourWallet',
});

// Subscribe
await brain.subscribe('month');

// Store knowledge
await brain.chat('FHE allows computation on encrypted data', undefined, 'store');

// Query your brain
const answer = await brain.chat('What is FHE?', undefined, 'learn');
console.log(answer.response);

// Upload file (client-side encrypted)
await brain.uploadEncrypted('My private research notes...');

// Browse other brains
const brains = await brain.searchBrains('solidity security');
const answer2 = await brain.chat('What are common vulnerabilities?', brains[0].id, 'learn');
```

> Coming in v1.0: `createBrainClient('sui', { ... })` for the Seal+Walrus+Phala stack on Sui.

---

## Deployed Contracts (Arbitrum Sepolia)

| Contract | Address |
|----------|---------|
| SubscriptionController | `0xCC42779858F1cd3F480aD33BcBc5A931D57DfFc3` |
| KnowledgeBaseRegistry | `0x36eca600679E73061318f8C10F6E43aFc06C96E0` |
| BrainKeyVault | `0x07beFe30F0C8Ef8B4c513da22A310eF84E9010c0` |

**Platform Authority**: `0x100690a32B562fd45e685BC2E63bbfF566d452db`

---

## Project Structure

```
packages/
├── api/              Express API server
│   ├── src/
│   │   ├── server.ts
│   │   ├── fhe/          CoFHE client + permit management
│   │   ├── routes/       chat, upload, brains, subscribe, openapi
│   │   ├── services/     chat (RAG), knowledge-ingest, rag
│   │   └── middleware/   auth, paywall (permit + subscription gates)
│   └── .env
├── contracts/        Solidity (Fhenix CoFHE)
│   ├── contracts/
│   │   ├── SubscriptionController.sol
│   │   ├── KnowledgeBaseRegistry.sol
│   │   └── BrainKeyVault.sol
│   └── scripts/deploy-brain-system.ts
├── sdk/              TypeScript SDK
│   └── src/brain/    BrainClient + encryption utilities
├── frontend/         Next.js app
│   └── src/app/      pages: chat, marketplace, payments, memory
└── shared/           Types, DB config, contract ABIs
```

---

## Security Model

| Threat | Mitigation |
|--------|-----------|
| Platform reads user data | FHE-encrypted keys — platform needs permit to decrypt |
| Impersonation | Permit is wallet-signed — proves identity cryptographically |
| Data breach | Content AES-encrypted on IPFS, key FHE-encrypted on-chain |
| Unauthorized access | `FHE.allow()` controls who can decrypt — revocable |
| Subscription snooping | Tier/expiry encrypted on-chain (`euint8`, `euint64`) |
| Content theft | Encrypted Merkle root proves ownership without revealing content |

---

## License

MIT

---

*Built for the Fhenix ecosystem. Privacy is not a feature — it's the architecture.*
