# FHE AI Context

**Privacy-Preserving AI Assistant using Fully Homomorphic Encryption (FHE) on Arbitrum**

FHE AI Context is a monorepo that implements a strictly privacy-preserving AI assistant. It leverages Fully Homomorphic Encryption via the [CoFHE protocol](https://docs.cofhe.com/) on Arbitrum to ensure that user context, sentiments, memory, and personal configurations remain entirely encrypted on-chain. The AI agent accesses this data via delegated decryption permits without exposing the user's plaintext state to the public ledger.

---

## 📝 Deployed Contracts (Arbitrum Sepolia)

The project leverages the following deployed contract infrastructure on the Arbitrum Sepolia network (Chain ID: `421614`):

- **AIContextManager**: [`0x9b7EAfe5f55e5Ec1027A07501e91f45028B1cCfa`](https://sepolia.arbiscan.io/address/0x9b7EAfe5f55e5Ec1027A07501e91f45028B1cCfa)
- **AIMemoryStore**: [`0xD6486d23c8906f30Cc4dF92722E2749E8Ddc1286`](https://sepolia.arbiscan.io/address/0xD6486d23c8906f30Cc4dF92722E2749E8Ddc1286)
- **AgentRegistry**: [`0xD3DB127F4d7e8719e5875dacd2593B99B118b0E8`](https://sepolia.arbiscan.io/address/0xD3DB127F4d7e8719e5875dacd2593B99B118b0E8)
- **Registered Agent Authority**: [`0x100690a32B562fd45e685BC2E63bbfF566d452db`](https://sepolia.arbiscan.io/address/0x100690a32B562fd45e685BC2E63bbfF566d452db)

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
*Created with focus on uncompromised privacy and AI usability.*
