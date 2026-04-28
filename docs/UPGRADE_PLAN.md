# FHE AI Context — Product Upgrade Plan

## Executive Summary

FHE AI Context is the **only product combining Fully Homomorphic Encryption with AI agent context management** on Ethereum L2. It is deployed and functional on Arbitrum Sepolia using Fhenix's CoFHE coprocessor.

This plan upgrades it from a working testnet prototype into a **production-grade privacy AI platform with an integrated privacy payment gateway** — targeting the Fhenix community first, then the broader web3 market.

**Why now**: Institutional DeFi moved $2.3B through private channels in Q3 2025. FHE reached practical readiness. No competitor offers a plug-and-play encrypted payment SDK for EVM dApps. First-mover advantage in confidential AI services will define market leaders.

---

## Current Product Inventory

### Architecture (4 packages, 87 source files)

```
packages/
├── contracts/   7 Solidity contracts + 3 interfaces + 3 tests
├── sdk/         14 TypeScript modules (encrypt/decrypt/permits/skills)
├── agent/       19 TypeScript modules (Express backend, FHE bridge, LLM)
└── frontend/    18 TypeScript modules (Next.js, Privy auth, pixel-art UI)
```

### Smart Contracts (Arbitrum Sepolia)

| Contract | Purpose | FHE Types Used | Status |
|---|---|---|---|
| AIContextManager | Encrypted user context (session, sentiment, trust, memory tier) | euint128, euint64, euint32, euint8, ebool, eaddress | ✅ Deployed |
| AIMemoryStore | Encrypted interaction history (hash, count, timestamp) | euint128, euint64, euint32, euint8 | ✅ Deployed |
| AgentRegistry | Agent registration + user→agent assignment | None (plaintext) | ✅ Deployed |
| SkillRegistry | Encrypted skill marketplace listings | euint32, euint64, eaddress, ebool | ✅ Deployed |
| AgentSkillVault | Encrypted license purchase + verification | euint64, eaddress, ebool | ✅ Deployed |
| SkillAccessController | Encrypted agent permission grants + consumption | eaddress, ebool, euint32 | ✅ Deployed |
| EncryptedPricer | Payment verification + fee computation + dynamic pricing | euint64, euint32, ebool | ✅ Deployed |

### Agent Backend (Express, port 3001)

| Route | Method | Purpose | Auth |
|---|---|---|---|
| /chat | POST | Send message, get AI response | Permit required |
| /permit/import | POST | Import CoFHE decryption permit | None |
| /permit/revoke | DELETE | Revoke active permit | None |
| /memory/update | POST | Manual memory update | None |
| /skill/list | POST | List new skill (encrypted) | Validation |
| /skill/purchase | POST | Purchase skill license (encrypted) | Validation |
| /skill/register-license | POST | Register license after on-chain tx | Validation |
| /skill/user/:address/licenses | GET | Get user's active licenses | None |
| /skill/:index/handles | GET | Get skill encrypted handles | None |
| /skill/count | GET | Total skills listed | None |
| /health | GET | Health check | None |

### Frontend (Next.js, port 3000)

| Page | Purpose |
|---|---|
| / | Landing page with wallet connect |
| /onboard | Write initial encrypted context on-chain |
| /chat | AI chat with permit-based decryption |
| /marketplace | Browse/purchase/list encrypted skills |
| /memory | View encrypted memory status |
| /settings | Manage permits and agent authorization |

### SDK Exports

| Module | Key Exports |
|---|---|
| context/ | `RawContext`, `DecryptedContext`, `ContextHandles`, `encryptContext()`, `decryptContext()` |
| memory/ | `encryptMemory()`, `decryptMemory()`, `hashMemory()` |
| skill/ | `SkillHandles`, `LicenseHandles`, `encryptSkillListing()`, `encryptSkillPurchase()` |
| permits/ | `createPermit()`, `importPermit()`, `revokePermit()` |
| client/ | `getCofheClient()`, `arbitrumSepolia`, `arbitrum` chain configs |

---

## Gap Analysis

### Critical (Blocks Production)

| # | Gap | Impact | Current State |
|---|---|---|---|
| G1 | No real token transfers | Skills are "purchased" but no tokens move | `purchaseSkill()` verifies encrypted amount but never calls `transferFrom()` |
| G2 | No conversation persistence | Users lose all chat history on page refresh | `responseHandler.ts` overwrites memory hash each message |
| G3 | Single agent per user | Cannot route to specialized agents | `AgentRegistry.userToAgent` is a 1:1 mapping |
| G4 | No revenue distribution | Platform fees computed but never collected | `EncryptedPricer.computeFee()` returns values but nothing transfers |
| G5 | No subscription model | One-time purchases only, no recurring revenue | No subscription contract exists |

### Important (Blocks Scale)

| # | Gap | Impact | Current State |
|---|---|---|---|
| G6 | No monitoring/observability | Cannot diagnose production issues | Single `/health` endpoint |
| G7 | No skill versioning | Cannot update or deprecate skills | `SkillRegistry` has no update/deactivate functions |
| G8 | Agent key is single point of failure | One compromised key affects all users | Single `AGENT_PRIVATE_KEY` for all operations |
| G9 | No developer documentation | Cannot onboard external developers | README only, no API docs |
| G10 | No CI/CD pipeline | Manual deployment, no automated testing | No GitHub Actions |

### Recently Fixed (Phase 1 — Completed)

| # | Fix | Files Changed |
|---|---|---|
| F1 | License persistence (JSON file cache) | `licenseCache.ts` (new), `skill.ts`, `chat.ts` |
| F2 | Rate limiting (sliding window) | `rateLimit.ts` (new), `index.ts` |
| F3 | Request validation middleware | `validate.ts` (new), `skill.ts`, `chat.ts` |
| F4 | Frontend error handling | `useChat.ts`, `usePermit.ts`, `useUserLicenses.ts` |

---

## Competitive Positioning

### Market Landscape (2026)

| Solution | Approach | EVM Compatible | Encrypted Payments | AI Integration | Composable |
|---|---|---|---|---|---|
| **FHE AI Context (us)** | FHE via CoFHE | ✅ Arbitrum | 🔨 Building | ✅ Native | ✅ |
| Aztec Network | ZK proofs L2 | ❌ Separate chain | ✅ Native | ❌ | ❌ Fragmented |
| Secret Network | TEE (Intel SGX) | ❌ Cosmos only | ✅ Native | ❌ | ❌ |
| Flashbots Protect | Private mempool | ✅ RPC swap | ❌ MEV only | ❌ | ✅ |
| Zama/fhEVM | FHE libraries | ✅ Custom L1 | 🔨 Building | ❌ | Partial |

### Our Unique Advantages
1. **Only FHE + AI product** — encrypted context management is a new category
2. **CoFHE single-line Solidity** — developers add privacy in hours, not months
3. **Arbitrum native** — no liquidity fragmentation, existing DeFi composability
4. **Skill marketplace** — encrypted AI skill economy with license management
5. **Permit-based delegation** — time-limited decryption without key sharing

---

## Upgrade Plan — 6 Phases

### Phase 2: FHERC-20 Payment Token + Real Token Transfers

**Goal**: Make skill purchases transfer actual encrypted tokens.

**New Contract**: `EncryptedPaymentToken.sol`
```
State: mapping(address => euint64) private encBalances
Functions:
  - mint(address to, bytes calldata inAmount) → onlyOwner
  - encryptedTransfer(address to, bytes calldata inAmount)
  - encryptedApprove(address spender, bytes calldata inAmount)
  - encryptedTransferFrom(address from, address to, bytes calldata inAmount)
  - getBalanceHandle(address user) → bytes32
Events: Transfer(address indexed from, address indexed to), Approval(...)
```

**Modified Contract**: `AgentSkillVault.sol`
```
Add: IERC20Encrypted public paymentToken (set in constructor)
Change purchaseSkill():
  1. Verify FHE.gte(payment, price) — already exists
  2. NEW: paymentToken.encryptedTransferFrom(buyer, developer, netAmount)
  3. NEW: paymentToken.encryptedTransferFrom(buyer, address(this), feeAmount)
  4. Use EncryptedPricer.computeFee() for split
Add: withdrawFees(bytes calldata inAmount) → onlyOwner
```

**SDK Changes**: Add `encryptPayment()`, `approvePayment()` to `packages/sdk/src/skill/encryptSkill.ts`

**Frontend Changes**: Add approval step before purchase in `useSkillMarketplace.ts`

**Files**: 1 new contract, 1 modified contract, 2 SDK files, 1 frontend hook, deploy script update

---

### Phase 3: Privacy Payment Gateway

**Goal**: Standalone encrypted payment system any web3 dApp can integrate.

**New Contract**: `PrivPayGateway.sol`
```
Structs:
  EncryptedInvoice { euint64 amount, eaddress recipient, ebool isPaid, uint256 expiry }
  EncryptedEscrow { bytes32 invoiceId, ebool released, ebool refunded }
  EncryptedSubscription { euint64 amount, eaddress recipient, uint256 interval, uint256 lastCharged, ebool active }

Functions:
  - createInvoice(bytes inAmount, bytes inRecipient, uint256 expiry) → bytes32 invoiceId
  - payInvoice(bytes32 invoiceId, bytes inPayment) → transfers via FHERC-20
  - createEscrow(bytes32 invoiceId) → bytes32 escrowId
  - releaseEscrow(bytes32 escrowId) → only recipient
  - refundEscrow(bytes32 escrowId) → only payer
  - createSubscription(bytes inAmount, bytes inRecipient, uint256 intervalSec) → bytes32 subId
  - chargeSubscription(bytes32 subId) → callable by recipient after interval
  - cancelSubscription(bytes32 subId) → only subscriber
  - getInvoiceHandles(bytes32) → encrypted handles for permit decryption
  - getSubscriptionHandles(bytes32) → encrypted handles

Events: InvoiceCreated, InvoicePaid, EscrowCreated, EscrowReleased, EscrowRefunded,
        SubscriptionCreated, SubscriptionCharged, SubscriptionCancelled
        (all emit only IDs + timestamps, never amounts or addresses)
```

**New SDK Package**: `packages/sdk/src/payment/`
```
paymentTypes.ts — EncryptedInvoice, PaymentReceipt, EscrowState, SubscriptionState
encryptPayment.ts — encryptInvoice(), encryptPayment(), encryptSubscription()
decryptPayment.ts — decryptInvoice(), decryptSubscription()
```

**Agent Integration**: New route `POST /payment/status` to check invoice/subscription state

**Files**: 1 new contract, 3 new SDK modules, 1 new agent route, deploy script update

---

### Phase 4: Conversation History Persistence

**Goal**: Chat history survives page refresh and agent restart.

**Agent Changes**:
```
NEW: packages/agent/src/services/conversationStore.ts
  - appendMessage(userAddress, role, content) → appends to per-user JSON file
  - getHistory(userAddress) → returns ChatMessage[]
  - File location: packages/agent/data/conversations/{address}.json
  - Encrypted at rest using AES-256 with key derived from AGENT_PRIVATE_KEY

MODIFIED: packages/agent/src/agent/responseHandler.ts
  - After LLM response, call conversationStore.appendMessage() for both user + assistant
  - Hash the FULL conversation history (not just last message) for on-chain memory update

NEW: packages/agent/src/routes/chat.ts — add GET /chat/history/:userAddress
  - Requires serializedPermit in query params for auth
  - Returns decrypted conversation history
```

**Frontend Changes**:
```
MODIFIED: packages/frontend/src/hooks/useChat.ts
  - On mount, fetch GET /chat/history/{userAddress}?permit=... to load previous messages
  - Populate messages state with history before user sends first message

MODIFIED: packages/frontend/src/app/chat/page.tsx
  - Show loading skeleton while history loads
  - Show "No previous conversations" if empty
```

**Files**: 1 new service, 2 modified agent files, 1 new route handler, 2 modified frontend files

---

### Phase 5: Multi-Agent Orchestration

**Goal**: Users authorize multiple specialized agents, messages route to the right one.

**Contract Changes**:
```
MODIFIED: packages/contracts/contracts/AgentRegistry.sol
  - Change: mapping(address => address) userToAgent → mapping(address => address[]) userAgents
  - Add: addAgent(address agent) — push to array
  - Add: removeAgent(address agent) — filter from array
  - Add: getUserAgents(address user) → address[]
  - Keep: isAgentAuthorized() — check if agent is in array
  - Remove: assignAgent() (replaced by addAgent)
  - Remove: revokeAgent() (replaced by removeAgent)
```

**Agent Changes**:
```
NEW: packages/agent/src/agent/agentRouter.ts
  - detectAndRoute(message, userAddress, permit):
    1. detectSkill(message) → get required skill
    2. If skill found, check which authorized agent has license for it
    3. Route to that agent's context/prompt
    4. If no skill, use default agent

MODIFIED: packages/agent/src/skills/skillDefinitions.ts
  - Add agentAddress field to SkillDefinition
  - Each skill declares which agent specializes in it
```

**Frontend Changes**:
```
MODIFIED: packages/frontend/src/app/settings/page.tsx
  - Show list of authorized agents with add/remove buttons
  - Each agent shows which skills it supports
```

**Files**: 1 modified contract, 1 new agent module, 2 modified agent files, 1 modified frontend page

---

### Phase 6: Monitoring, Observability & Production Hardening

**Goal**: Production-ready error handling, metrics, and resilience.

**Agent Changes**:
```
NEW: packages/agent/src/middleware/logger.ts
  - Structured JSON logging using console (no new deps)
  - Log: method, path, status, duration, requestId
  - Attach requestId to all log lines via AsyncLocalStorage

NEW: packages/agent/src/middleware/circuitBreaker.ts
  - Wrap blockchain RPC calls with retry + exponential backoff
  - 3 retries, 1s/2s/4s delays
  - After 5 consecutive failures, open circuit for 30s

MODIFIED: packages/agent/src/index.ts
  - Add /metrics endpoint: request counts, error rates, avg latency
  - Add graceful shutdown: on SIGTERM, stop accepting new requests, finish in-flight

MODIFIED: packages/agent/src/services/blockchainService.ts
  - Wrap all contract calls with circuit breaker
```

**Frontend Changes**:
```
MODIFIED: packages/frontend/src/app/layout.tsx
  - Add connection status indicator (green/yellow/red dot)
  - Show banner when agent backend is unreachable
```

**Files**: 2 new middleware, 2 modified agent files, 1 modified frontend file

---

### Phase 7: Documentation, Deployment & Community Launch

**Goal**: External developers can integrate in 30 minutes. One-command deployment.

**Documentation**:
```
NEW: docs/
  ├── README.md              — 5-minute quickstart
  ├── architecture.md        — System design with data flow diagrams
  ├── contracts-api.md       — Every contract function with examples
  ├── sdk-reference.md       — Every SDK export with TypeScript signatures
  ├── agent-api.md           — REST API reference (OpenAPI-style)
  ├── privacy-payments.md    — PrivPay integration guide for external dApps
  ├── security-model.md      — Threat model, trust assumptions, FHE guarantees
  └── deployment.md          — Step-by-step mainnet deployment checklist
```

**Deployment**:
```
NEW: docker-compose.yml — agent + frontend containers
NEW: scripts/deploy-all.sh — compile contracts, build SDK, deploy, configure
NEW: .github/workflows/ci.yml — lint, compile, test on every PR
MODIFIED: packages/contracts/scripts/deploy.ts — add EncryptedPaymentToken + PrivPayGateway
MODIFIED: packages/contracts/scripts/verify.ts — verify all contracts on Arbiscan
```

**Examples**:
```
NEW: examples/
  ├── simple-payment/    — Minimal dApp using PrivPay SDK for encrypted invoices
  └── skill-integration/ — How to add a custom AI skill to the marketplace
```

**Files**: 8 doc files, 3 deployment files, 2 example projects, 2 modified scripts

---

## Implementation Priority Matrix

| Phase | Effort | Impact | Dependencies | Timeline |
|---|---|---|---|---|
| Phase 2: FHERC-20 Token | Medium | Critical — enables real economy | None | Week 1-2 |
| Phase 3: PrivPay Gateway | Large | High — standalone product | Phase 2 (needs token) | Week 2-4 |
| Phase 4: Conversation History | Small | High — core UX improvement | None | Week 1 |
| Phase 5: Multi-Agent | Medium | Medium — enables specialization | None | Week 3-4 |
| Phase 6: Production Hardening | Medium | High — required for mainnet | None | Week 2-3 |
| Phase 7: Docs & Launch | Medium | Critical — enables community | Phases 2-6 | Week 4-5 |

**Recommended execution order**: Phase 4 → Phase 2 → Phase 6 → Phase 3 → Phase 5 → Phase 7

Rationale: Phase 4 (conversation history) is the smallest change with highest UX impact — ship it first. Phase 2 (real tokens) unlocks the economic model. Phase 6 (hardening) is needed before Phase 3 goes live. Phase 3 (PrivPay) is the flagship feature. Phase 5 (multi-agent) adds depth. Phase 7 (docs) wraps everything for launch.

---

## File Change Summary

| Phase | New Files | Modified Files | New Contracts |
|---|---|---|---|
| Phase 1 ✅ | 4 | 7 | 0 |
| Phase 2 | 1 contract, 2 SDK | 2 contracts, 1 hook, 1 deploy script | EncryptedPaymentToken |
| Phase 3 | 1 contract, 3 SDK, 1 route | 1 deploy script | PrivPayGateway |
| Phase 4 | 1 service | 3 agent, 2 frontend | 0 |
| Phase 5 | 1 agent module | 1 contract, 2 agent, 1 frontend | 0 |
| Phase 6 | 2 middleware | 3 agent, 1 frontend | 0 |
| Phase 7 | 8 docs, 3 deploy, 2 examples | 2 scripts | 0 |
| **Total** | **~30 new files** | **~25 modified files** | **2 new contracts** |

---

## Success Metrics

| Metric | Target | Measurement |
|---|---|---|
| Developer onboarding time | < 30 minutes from clone to working demo | Timed test with fresh developer |
| Encrypted payment latency | < 5 seconds end-to-end | Agent metrics endpoint |
| Conversation continuity | 100% history preserved across restarts | Automated test |
| Skill marketplace transactions | > 100 test purchases in first month | On-chain event count |
| Community SDK integrations | > 5 external dApps using PrivPay | GitHub dependency tracking |
| Uptime | > 99.5% | Health check monitoring |

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| CoFHE testnet instability | Medium | High | Circuit breaker + retry logic (Phase 6) |
| FHE gas costs too high for mainnet | Medium | High | Batch operations, optimize contract storage |
| Fhenix CoFHE API breaking changes | Low | High | Pin SDK version, abstract behind our SDK layer |
| Low community adoption | Medium | Medium | Example projects, hackathon sponsorship, docs |
| Smart contract vulnerability | Low | Critical | Audit before mainnet, use established FHE patterns |

---

*Generated: 2026-04-27 | Project: FHE AI Context | Status: Phase 1 Complete, Phases 2-7 Planned*
