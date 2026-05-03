# FHE AI Context

**Privacy-Preserving AI Assistant using Fully Homomorphic Encryption (FHE) on Arbitrum**

FHE AI Context is a monorepo that implements a strictly privacy-preserving AI assistant. It leverages Fully Homomorphic Encryption via the [CoFHE protocol](https://docs.cofhe.com/) on Arbitrum to ensure that user context, sentiments, memory, and personal configurations remain entirely encrypted on-chain. The AI agent accesses this data via delegated decryption permits without exposing the user's plaintext state to the public ledger.

---

## 📝 Deployed Contracts (Arbitrum Sepolia)

All contracts are deployed on Arbitrum Sepolia (Chain ID: `421614`):

| Contract | Address |
|----------|---------|
| **AgentRegistry** | [`0xEf3Cd0D1b103dCF478c9aEe9782d14a8Cb67B996`](https://sepolia.arbiscan.io/address/0xEf3Cd0D1b103dCF478c9aEe9782d14a8Cb67B996) |
| **AIContextManager** | [`0x9fcc68828645619F779D71Dd1a416a37a4F8A99C`](https://sepolia.arbiscan.io/address/0x9fcc68828645619F779D71Dd1a416a37a4F8A99C) |
| **AIMemoryStore** | [`0x85082881c440d6f74048cCA32BFcCf3bEd1CA637`](https://sepolia.arbiscan.io/address/0x85082881c440d6f74048cCA32BFcCf3bEd1CA637) |
| **SkillRegistry** | [`0xc44EE34413ac3B722363aF9a2a63975f756b69b0`](https://sepolia.arbiscan.io/address/0xc44EE34413ac3B722363aF9a2a63975f756b69b0) |
| **EncryptedPricer** | [`0x3467738ea870D666DA5959ac50321e1b6F9f47b6`](https://sepolia.arbiscan.io/address/0x3467738ea870D666DA5959ac50321e1b6F9f47b6) |
| **SkillAccessController** | [`0xbFcFfD5565B6CFE81F239D1F2a840A605f0E6DCb`](https://sepolia.arbiscan.io/address/0xbFcFfD5565B6CFE81F239D1F2a840A605f0E6DCb) |
| **AgentSkillVault** | [`0x459F5D7A9787abC94cF07389097372733B962Ecc`](https://sepolia.arbiscan.io/address/0x459F5D7A9787abC94cF07389097372733B962Ecc) |
| **EncryptedPaymentToken** | [`0xFc999D677B899f8594dc8C8F9394aCB0CDeC3BDe`](https://sepolia.arbiscan.io/address/0xFc999D677B899f8594dc8C8F9394aCB0CDeC3BDe) |
| **PrivPayGateway** | [`0xDbBAe21A4b1440a3ba00BD23ba2daE403647629A`](https://sepolia.arbiscan.io/address/0xDbBAe21A4b1440a3ba00BD23ba2daE403647629A) |
| **AgentBilling** | [`0x01edad8BF4F38426A95dfb8Df4f02F8c26925360`](https://sepolia.arbiscan.io/address/0x01edad8BF4F38426A95dfb8Df4f02F8c26925360) |
| **SettlementLedger** | [`0xf4bc742849Bd2Daa07Ed23EeA8eD8938F1BDf9f4`](https://sepolia.arbiscan.io/address/0xf4bc742849Bd2Daa07Ed23EeA8eD8938F1BDf9f4) |

**Registered Agent Authority**: [`0x100690a32B562fd45e685BC2E63bbfF566d452db`](https://sepolia.arbiscan.io/address/0x100690a32B562fd45e685BC2E63bbfF566d452db)

### 📋 Sample On-Chain Transactions

| Operation | Transaction |
|-----------|-------------|
| Agent Registration | [`0x61546c8f...`](https://sepolia.arbiscan.io/tx/0x61546c8f3213bdf64c1072af73caa5e63b907d4ea96fc16a52beab82a51d3479) |
| Agent Assignment | [`0x89349fcf...`](https://sepolia.arbiscan.io/tx/0x89349fcfa60078200d180828ba3b489a90b3005acf9931ca666a8c3a52afe272) |
| Memory Agent Authorization | [`0x8ad940c2...`](https://sepolia.arbiscan.io/tx/0x8ad940c256bcf5dc54e399878e79788111c39d8722a08e15e8114abc686179d2) |

---

## 🛠 Architecture & Components

The workspace is structured as a monorepo consisting of four core packages:

### 1. `packages/sdk` (TypeScript SDK)
The core bridge between the encrypted on-chain state and the application logic. 
- **Encryption/Decryption Context**: Handles encrypting/decrypting user memory and session contexts using the CoFHE SDK.
- **Permit Management**: Manages time-limited decryption delegations via permits (`createPermit`, `importPermit`, `revokePermit`).
- **Utilities**: Context hashing, memory serialization, and encoding functions.

### 2. `packages/contracts` (Solidity Smart Contracts)
Deployed to Arbitrum Sepolia (Chain ID: `421614`).
- **`AIContextManager`**: Stores encrypted user context fields (`sessionKey`, `sentimentScore`, `trustLevel`, `memoryTier`). Uses operations like `FHE.asEuint128/64` to store and conditionally update encrypted states seamlessly on-chain.
- **`AIMemoryStore`**: Tracks encrypted interaction counts and timestamps. Restricted to only the user or their authorized agents to perform updates.
- **`AgentRegistry`**: A registry enabling AI agents to register themselves, and users to assign an agent securely.

### 3. `packages/agent` (Express Backend)
The AI agent gateway running on Node.js (default port: `3001`).
- Operates primarily using the `POST /chat` endpoint.
- **Workflow**:
  1. Accepts `userAddress`, `message`, and `serializedPermit`.
  2. Uses the permit to securely authenticate and decrypt the user's context/memory.
  3. Dynamically builds an LLM system prompt adjusting the tone/instructions based on the encrypted `trustLevel` and `sentimentScore`.
  4. Calls the LLM (OpenAI/Gemini) to generate a response.
  5. Fire-and-forget mechanisms update the memory state on-chain asynchronously.

#### Backend API Routes:
- `POST /chat`: Receive messages and return AI responses securely.
- `POST /permit/import`: Import an agent permit for subsequent decryption.
- `DELETE /permit/revoke`: Revoke an active permit.
- `POST /memory/update`: Manually trigger an on-chain memory update.

### 4. `packages/frontend` (Next.js Application)
A pixel-art retro-themed client-side application (default port: `3000`).
- **Wallet Authentication**: Utilizes Privy for quick and secure wallet connections.
- **WebAssembly Constraints**: Designed specifically with Next.js configurations (`next.config.mjs`) to allow seamless asynchronous WASM loading required by the `@cofhe/sdk`.
- Provides UI components to view Context Status, Manage Permits remotely, and standard chat interfaces.

---

## 🚀 How to Run Locally

### Prerequisites
- Node.js (v18+)
- npm or yarn
- Wallet with Arbitrum Sepolia ETH (for contract deployment)

### 1. Clone the Repository
```bash
git clone https://github.com/phamdat721101/privacy-context
cd privacy-context
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Setup Environment Variables
Initialize standard configuration files:
```bash
# Setup root environment
cp .env.example .env

# Setup agent environment
cp packages/agent/.env.example packages/agent/.env  # If existed, otherwise create manually
```

**Required Agent `.env` Configurations (`packages/agent/.env`)**:
- `AGENT_PRIVATE_KEY`: Your backend agent wallet private key.
- `OPENAI_API_KEY`: API key for LLM services.
- `PORT=3001`
- RPC URLs pointing to Arbitrum Sepolia.

**Required Frontend `.env` Configurations (`packages/frontend/.env.local`)**:
- `NEXT_PUBLIC_PRIVY_APP_ID`: Your Privy app ID.
- `NEXT_PUBLIC_AGENT_BACKEND_URL=http://localhost:3001`
- `NEXT_PUBLIC_CHAIN_ID=421614`

### 4. Smart Contracts Construction
Compile the Solidity code and execute the deployment scripts targeted toward Arbitrum Sepolia.
```bash
npm run contracts:compile
npm run contracts:deploy:sepolia
```
*Note: Once deployed, locate the addresses stored in `packages/contracts/deployments/arbitrum-sepolia.json` and update both `packages/agent/.env` and `packages/frontend/.env.local` to point to the correct deployed contracts.*

### 5. Build the SDK
The SDK **must** be built before either the Agent or Frontend services can start running.
```bash
npm run sdk:build
```

### 6. Start the Applications
You can start the frontend and agent separately:
```bash
npm run agent:dev      # Starts backend on http://localhost:3001
npm run frontend:dev   # Starts frontend on http://localhost:3000
```
**Alternatively**, start both systems concurrently utilizing the startup script!
```bash
./scripts/start.sh
```

---

## 🔒 Privacy Mode (v0.3)

FHE AI Context v0.3 adds three-layer privacy protection for agent payments and analytics:

| Layer | Technology | What's Hidden |
|-------|-----------|---------------|
| **Amount Privacy** | FHERC20 (EncryptedPaymentToken) | Payment amounts on-chain |
| **Metadata Privacy** | PII regex filter (SDK) | Emails, SSNs, phones in messages |
| **Context Privacy** | FHE-encrypted analytics (CoFHE) | Agent decision context in logs |

### Enable Privacy

**Frontend:** Settings → Privacy Mode → choose OFF / PII FILTER / FULL FHE

**Agent env:** Set `PRIVACY_MODE=fhe` (or `metadata-only`)

**Programmatic (SDK):**
```typescript
import { MetadataFilter, ContextSeal } from '@fhe-ai-context/sdk';

const filter = new MetadataFilter();
const result = filter.filter('Contact john@email.com');
// result.filtered === 'Contact [EMAIL]'
```

### Docker Quick Start

```bash
cp .env.example .env  # Edit with your keys
docker-compose up --build
```

See [Community Test Guide](./docs/COMMUNITY_TEST_GUIDE.md) for full testing instructions.

---
*Created with focus on uncompromised privacy and AI usability.*
