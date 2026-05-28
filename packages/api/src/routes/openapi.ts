import { Router } from 'express';

const router = Router();

const PRICE_PER_QUERY_USDC = '0.01';

/**
 * /openapi.json — agent-discovery contract.
 *
 * Per docs/UNIFIED_FLOW_SPEC.md "OpenAPI extensions", agent-aware fields
 * advertise pricing, identity requirements, and attestation providers so
 * AI agents can self-serve the spec and decide whether to call.
 */
const spec = {
  openapi: '3.0.3',
  info: {
    title: 'OpenX / FHE Second Brain API',
    version: '2.0.0',
    description:
      'Patreon for AI agents. Sellers publish encrypted brains; agents pay per query in USDC over x402; the platform is cryptographically blind. ERC-8004 identity supported via the `x-erc8004-agent-id` header.',
    'x-usp': 'Get paid when AI agents query your brain. The platform cannot read your knowledge.',
  },
  servers: [{ url: process.env.DOMAIN ? `https://${process.env.DOMAIN}` : 'http://localhost:3001' }],
  paths: {
    '/v2/upload': {
      post: {
        summary: 'Publish a brain (seller side, atomic)',
        description: 'Seller-only. Accepts opaque AES-256-GCM ciphertext + an on-chain key tx hash + optional publishMeta to publish atomically.',
        'x-kya-required': false,
        'x-price-usdc': '0',
        'x-actor': 'seller',
        responses: {
          '200': { description: '{ brainId, estimatedChunks, privacyVersion, published }' },
          '400': { description: 'Plaintext key material rejected' },
        },
      },
    },
    '/v2/inference': {
      post: {
        summary: 'Ask a brain (buyer / agent side, TEE-attested)',
        description: 'Stateless inference. Receives top-K decrypted chunks from the browser, returns answer + attestation. Phala TEE when configured; off-chain TN signature otherwise.',
        'x-kya-required': true,
        'x-min-reputation': 0,
        'x-price-usdc': PRICE_PER_QUERY_USDC,
        'x-attestation-providers': ['phala-tee', 'fhenix-tn'],
        'x-chain-options': ['arbitrum-sepolia'],
        'x-actor': 'agent-or-human',
        responses: {
          '200': { description: '{ answer, attestation: { provider, verified, signature?, hash? } }' },
          '402': { description: 'Subscription or per-query payment required' },
        },
      },
    },
    '/chat': {
      post: {
        summary: 'Ask a brain (legacy human path, server-side RAG)',
        description: 'Human-facing chat. Subscription-gated. Prefer /v2/inference for agent traffic.',
        'x-kya-required': false,
        'x-price-usdc': PRICE_PER_QUERY_USDC,
        'x-attestation-providers': [],
        'x-actor': 'human',
        responses: { '200': { description: 'AI response' }, '402': { description: 'Subscription required' } },
      },
    },
    '/brains': {
      get: {
        summary: 'List published brains',
        'x-kya-required': false,
        'x-price-usdc': '0',
        responses: { '200': { description: 'Array of published brains with id, title, tags, owner_address' } },
      },
    },
    '/brains/{id}': {
      get: {
        summary: 'Get a brain by id',
        'x-kya-required': false,
        'x-price-usdc': '0',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Brain detail' }, '404': { description: 'Not found' } },
      },
    },
    '/brains/search': {
      get: {
        summary: 'Search brains',
        parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }],
        'x-kya-required': false,
        'x-price-usdc': '0',
        responses: { '200': { description: 'Search results' } },
      },
    },
    '/brains/earnings/{wallet}': {
      get: {
        summary: 'Read your earnings (seller only)',
        description: 'Returns total USDC earned, per-brain breakdown, and the most recent receipts.',
        'x-actor': 'seller',
        'x-kya-required': false,
        'x-price-usdc': '0',
        parameters: [{ name: 'wallet', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Earnings payload' }, '403': { description: 'Self-only' } },
      },
    },
    '/health': { get: { summary: 'Health check', 'x-price-usdc': '0', responses: { '200': { description: 'OK' } } } },
    '/metrics': { get: { summary: 'Prometheus metrics', 'x-price-usdc': '0', responses: { '200': { description: 'metrics' } } } },
    '/v4/memory': {
      post: {
        summary: 'Write a signed agent memory entity to Arkiv (auth required)',
        description: 'Memory-Agent posts a LearnedFact whose canonical body is signed with its own wallet. The platform relays the GLM gas to Braga and injects the project attribute. Reads are free via createPublicClient; only the signer can write under their agentId.',
        'x-actor': 'agent',
        'x-kya-required': false,
        'x-price-usdc': '0',
        'x-storage-provider': 'arkiv-braga',
        responses: { '200': { description: '{ entityKey, txHash }' }, '400': { description: 'Missing signed fact' }, '503': { description: 'Arkiv backend not configured' } },
      },
    },
    '/v4/memory/{entityKey}': {
      get: {
        summary: 'Read a single memory entity (free, public)',
        'x-actor': 'agent-or-human',
        'x-kya-required': false,
        'x-price-usdc': '0',
        'x-storage-provider': 'arkiv-braga',
        parameters: [{ name: 'entityKey', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: '{ entityKey, attributes, payloadB64 }' }, '404': { description: 'Not found' } },
      },
    },
    '/v4/memory/by-agent/{agentId}': {
      get: {
        summary: 'List memory entities owned by a specific agent (free, paginated)',
        'x-kya-required': false,
        'x-price-usdc': '0',
        parameters: [
          { name: 'agentId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'cursor', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 20, maximum: 100 } },
        ],
        responses: { '200': { description: '{ items, nextCursor }' } },
      },
    },
    '/v4/memory/find': {
      post: {
        summary: 'Topic-filtered memory query with confidence threshold',
        description: 'Returns parsed LearnedFacts with verified signatures (entities that fail signature recovery are skipped, never returned).',
        'x-kya-required': false,
        'x-price-usdc': '0',
        responses: { '200': { description: '{ count, facts, entityKeys }' } },
      },
    },
    '/v4/memory/{entityKey}/extend': {
      post: {
        summary: 'Pay 0.01 USDC (x402) to extend a memory entity\'s TTL by 30 days',
        description: 'Anyone can fund the continued storage of any memory. Receipts are anchored on Ethereum L1 via Arkiv\'s settlement layer. Demonstrates "storage TTL as a market mechanic".',
        'x-actor': 'agent-or-human',
        'x-kya-required': false,
        'x-price-usdc': '0.01',
        'x-attestation-providers': ['arkiv-braga'],
        parameters: [{ name: 'entityKey', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: '{ txHash, extendedSeconds }' }, '402': { description: 'Payment required' } },
      },
    },
    '/v4/decisions': {
      post: {
        summary: 'Write a signed AgentDecision (2nd entity type, AI reputation log)',
        description: 'Memory-Agent posts a decision verdict (use-prior | query-brain) per task cycle. The platform relays GLM gas to Braga and stamps the project attribute. Free public reads via /v4/decisions/by-agent/:id.',
        'x-actor': 'agent',
        'x-kya-required': false,
        'x-price-usdc': '0',
        'x-storage-provider': 'arkiv-braga',
        'x-entity-type': 'agent-decision',
        responses: { '200': { description: '{ entityKey, txHash }' }, '400': { description: 'Missing signed decision' }, '503': { description: 'Arkiv backend not configured' } },
      },
    },
    '/v4/decisions/by-agent/{agentId}': {
      get: {
        summary: 'List an agent\'s decision log (free, paginated)',
        description: 'AI-theme reputation log per the Arkiv ETHNS Builder Challenge. Each entity is an immutable, signed record of what the Memory-Agent decided (use-prior vs query-brain). Linked to memories via the shared agentId+topic attributes.',
        'x-actor': 'agent-or-human',
        'x-kya-required': false,
        'x-price-usdc': '0',
        'x-storage-provider': 'arkiv-braga',
        'x-entity-type': 'agent-decision',
        parameters: [
          { name: 'agentId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 20, maximum: 100 } },
        ],
        responses: { '200': { description: '{ items: [{ entityKey, attributes }] }' } },
      },
    },
    '/v4/decisions/find': {
      post: {
        summary: 'Topic + verdict-filtered decision query (signature-verified)',
        description: 'Returns parsed AgentDecisions whose signature recovers to the declared signer; entities that fail verification are silently skipped. Filterable by topic and decision verdict.',
        'x-kya-required': false,
        'x-price-usdc': '0',
        'x-storage-provider': 'arkiv-braga',
        'x-entity-type': 'agent-decision',
        responses: { '200': { description: '{ count, decisions, entityKeys }' } },
      },
    },
    '/v4/chat-with-memory': {
      post: {
        summary: 'Read-back chat over a wallet\'s sovereign memory namespace',
        description: 'Pillar 2 of the sovereign tier — agent runs ownedBy(<user>) on Arkiv, builds a strict prompt that may only cite the returned memories, and returns answer + inline [n] citations resolving to live entityKeys.',
        'x-actor': 'agent-or-human',
        'x-kya-required': false,
        'x-price-usdc': '0',
        responses: { '200': { description: '{ answer, citations: [{index, entityKey, snippet, confidence, derivedAt}], memoriesConsidered }' } },
      },
    },
    '/v4/onboard/unfurl': {
      get: {
        summary: 'Server-side fetch of og:title / og:description for a URL',
        description: 'Helper for the SovereignSaveForm preview card. Capped at 1 MB / 5 s; SSRF-blocked against private hosts. Pure read, no Arkiv I/O.',
        parameters: [{ name: 'url', in: 'query', required: true, schema: { type: 'string' } }],
        'x-kya-required': false,
        'x-price-usdc': '0',
        responses: { '200': { description: '{ url, hostname, title, description, image }' }, '400': { description: 'invalid url' }, '504': { description: 'timeout' } },
      },
    },
  },
  components: {
    securitySchemes: {
      wallet: { type: 'apiKey', in: 'header', name: 'x-wallet-address', description: 'Caller wallet address (seller or buyer)' },
      kya: { type: 'apiKey', in: 'header', name: 'x-erc8004-agent-id', description: 'ERC-8004 agent id; resolved to identity via the canonical Identity registry' },
      chain: { type: 'apiKey', in: 'header', name: 'x-chain', description: 'Optional: arbitrum-sepolia | base-sepolia' },
    },
  },
};

router.get('/', (_, res) => res.json(spec));

export default router;
