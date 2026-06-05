/**
 * MCP tool registry — declarative list. Adding a tool = appending one entry.
 *
 * Schema follows the MCP `tools/list` contract (name, description, inputSchema).
 * `paid` triggers the `-32402 Payment Required` envelope in the dispatch layer
 * (see `server.ts`). `_meta` annotations are echoed verbatim to the client so
 * agent hosts can introspect price + KYA-tier requirements without calling.
 */

import type { OpenXClient, MemoryId } from '../openx';

export interface PaymentEnvelope {
  rail: 'sui_usdc';
  amount_usdc: string;
  pay_to: string;
  endpoint: string;
  tool: string;
}

export interface ToolHandlerCtx {
  openx: OpenXClient;
  args: Record<string, unknown>;
  callerAddress?: string;
}

export type ToolHandler = (ctx: ToolHandlerCtx) => Promise<unknown>;

export interface ToolMeta {
  name: string;
  description: string;
  paid: boolean;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  _meta?: Record<string, unknown>;
}

export interface ToolDef extends ToolMeta {
  handler: ToolHandler;
}

const tStr = { type: 'string' };
const tInt = { type: 'integer' };

export const TOOLS: ToolDef[] = [
  {
    name: 'openx_brain_search',
    description: 'Semantic search across published OpenX brains. Free.',
    paid: false,
    inputSchema: { type: 'object', properties: { query: tStr, topK: tInt }, required: ['query'] },
    handler: async ({ openx, args }) => openx.recall(args.query as string, { topK: args.topK as number }),
  },
  {
    name: 'openx_brain_remember',
    description: 'Store text into the caller-owned brain (requires owner key).',
    paid: false,
    inputSchema: { type: 'object', properties: { text: tStr, namespace: tStr }, required: ['text'] },
    handler: async ({ openx, args }) =>
      ({ memoryId: await openx.remember(args.text as string, { namespace: args.namespace as string }) }),
  },
  {
    name: 'openx_brain_recall',
    description: 'Paid retrieval of memories from a target brain (semantic search + decryption).',
    paid: true,
    inputSchema: { type: 'object', properties: { query: tStr, topK: tInt }, required: ['query'] },
    _meta: { 'x-x402': { method: 'sui-usdc', currency: 'USDC' } },
    handler: async ({ openx, args }) => openx.recall(args.query as string, { topK: args.topK as number }),
  },
  {
    name: 'openx_brain_ask',
    description: 'Paid LLM-answered query with cited memories + TEE attestation.',
    paid: true,
    inputSchema: { type: 'object', properties: { query: tStr, topK: tInt }, required: ['query'] },
    _meta: { 'x-x402': { method: 'sui-usdc', currency: 'USDC' } },
    handler: async ({ openx, args }) => openx.ask(args.query as string, { topK: args.topK as number }),
  },
  {
    name: 'openx_brain_publish',
    description: 'Publish a brain to the OpenX catalog (one-time setup; free).',
    paid: false,
    inputSchema: { type: 'object', properties: { brainId: tStr, title: tStr } },
    handler: async ({ args }) => ({ ok: true, note: 'wired in Phase 2 — for now use the web /brain UI', args }),
  },
  {
    name: 'openx_brain_cost',
    description: 'Cost dashboard for a brain — Walrus storage + read pricing in USD + WAL.',
    paid: false,
    inputSchema: { type: 'object', properties: { brainId: tStr }, required: ['brainId'] },
    handler: async ({ args }) => ({ brainId: args.brainId, hint: 'Hit GET /v3/brains/:id/cost — wired Task 6.' }),
  },
  {
    name: 'openx_brain_restore',
    description: 'Sovereignty proof — rebuild chunk index from Walrus alone (trustless tier only).',
    paid: false,
    inputSchema: { type: 'object', properties: { brainId: tStr }, required: ['brainId'] },
    handler: async ({ openx, args }) => openx.restore(args.brainId as string),
  },

  // ─── MemWal-tier tools (PRD-09 / @openx/memwal-adapter) ─────────────────
  // These tools sit ABOVE upstream `@mysten-incubation/memwal-mcp`. The
  // host invokes them, the gateway forwards to the OpenX API which speaks
  // to MemWal via `OpenXMemWalAdapter`. Three-proof attestation + payment
  // gating are server-side; the host just sees a uniform tool response.
  {
    name: 'memwal_marketplace_list',
    description:
      'List paid MemWal-tier brains. Filters: cognitive_level (1-5), max_price_usdc, kya, q (keyword).',
    paid: false,
    inputSchema: {
      type: 'object',
      properties: {
        cognitive_level: tInt,
        max_price_usdc: { type: 'number' },
        kya: tStr,
        q: tStr,
      },
    },
    handler: async ({ openx, args }) => memwalFetch(openx, '/v3/memory/marketplace', 'GET', undefined, args),
  },
  {
    name: 'memwal_marketplace_query',
    description:
      'Paid recall against a published MemWal brain. Returns recall results + three-proof attestation (Phala/Sui/Walrus).',
    paid: true,
    inputSchema: {
      type: 'object',
      properties: {
        brain_id: tStr,
        query: tStr,
        limit: tInt,
        min_relevance: { type: 'number' },
      },
      required: ['brain_id', 'query'],
    },
    _meta: { 'x-x402': { method: 'sui-usdc', currency: 'USDC' } },
    handler: async ({ openx, args }) =>
      memwalFetch(openx, `/v3/memory/brain/${args.brain_id}/query`, 'POST', {
        query: args.query,
        limit: args.limit,
        minRelevance: args.min_relevance,
      }),
  },
  {
    name: 'memwal_remember',
    description: 'Store text in the caller-owned MemWalAccount. Sui-only — fails closed off Sui.',
    paid: false,
    inputSchema: {
      type: 'object',
      properties: { text: tStr, namespace: tStr },
      required: ['text'],
    },
    handler: async ({ openx, args }) =>
      memwalFetch(openx, '/v3/memory/remember', 'POST', { text: args.text, namespace: args.namespace }),
  },
  {
    name: 'memwal_recall',
    description: 'Semantic recall against the caller-owned MemWalAccount. Sui-only.',
    paid: false,
    inputSchema: {
      type: 'object',
      properties: { query: tStr, namespace: tStr, limit: tInt, min_relevance: { type: 'number' } },
      required: ['query'],
    },
    handler: async ({ openx, args }) =>
      memwalFetch(openx, '/v3/memory/recall', 'POST', {
        query: args.query,
        namespace: args.namespace,
        limit: args.limit,
        minRelevance: args.min_relevance,
      }),
  },
  {
    name: 'memwal_analyze',
    description:
      'LLM-extract facts from a longer text and bulk-store them under the caller-owned MemWalAccount. Sui-only.',
    paid: false,
    inputSchema: {
      type: 'object',
      properties: { text: tStr, namespace: tStr },
      required: ['text'],
    },
    handler: async ({ openx, args }) =>
      memwalFetch(openx, '/v3/memory/analyze', 'POST', { text: args.text, namespace: args.namespace }),
  },
  {
    name: 'memwal_restore',
    description:
      'Rebuild the relayer index for one of the caller-owned namespaces from Walrus alone (sovereignty op).',
    paid: false,
    inputSchema: {
      type: 'object',
      properties: { namespace: tStr, limit: tInt },
      required: ['namespace'],
    },
    handler: async ({ openx, args }) =>
      memwalFetch(openx, '/v3/memory/restore', 'POST', { namespace: args.namespace, limit: args.limit }),
  },
  {
    name: 'openx_memwal_my_earnings',
    description:
      'Seller-only read: published MemWal brains + cumulative settlement totals + 24h query count.',
    paid: false,
    inputSchema: { type: 'object', properties: {} },
    handler: async ({ openx }) => memwalFetch(openx, '/v3/memory/operator/stats', 'GET'),
  },
  {
    name: 'openx_memwal_publish',
    description:
      'Cache the metadata of a MemWalBrain Sui object after the seller has submitted the on-chain publish_brain tx. Idempotent on suiObjectId.',
    paid: false,
    inputSchema: {
      type: 'object',
      properties: {
        suiObjectId: tStr,
        memwalAccountId: tStr,
        namespace: tStr,
        title: tStr,
        description: tStr,
        pricePerQueryUsdc: tStr,
        kyaRequired: { type: 'boolean' },
        attestationRequired: tInt,
        cognitiveLevel: tInt,
        sovereigntyProofUrl: tStr,
      },
      required: ['suiObjectId', 'memwalAccountId', 'namespace', 'title'],
    },
    handler: async ({ openx, args }) =>
      memwalFetch(openx, '/v3/memory/marketplace/publish', 'POST', args),
  },
];

// Re-export MemoryId so MCP consumers don't need a second import.
export type { MemoryId };

// ─── MemWal helper — used by the four memwal_* tool handlers above ───────
// Routes through the OpenX API since the buyer never holds delegate keys.
// SOLID: single function = single concern = uniform error envelope.
async function memwalFetch(
  openx: OpenXClient,
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
  query?: Record<string, unknown>,
): Promise<unknown> {
  const apiUrl = (openx as unknown as { apiUrl?: string }).apiUrl ?? '';
  const wallet = (openx as unknown as { walletAddress?: string }).walletAddress;
  const url = new URL(path, apiUrl || 'http://localhost:3001');
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = { 'x-chain': 'sui' };
  if (wallet) headers['x-wallet-address'] = wallet;
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const json = text ? JSON.parse(text) : {};
  if (!r.ok) {
    const err = new Error(json?.message ?? `HTTP ${r.status}`) as Error & {
      code?: string;
      status?: number;
    };
    err.code = json?.error;
    err.status = r.status;
    throw err;
  }
  return json;
}
