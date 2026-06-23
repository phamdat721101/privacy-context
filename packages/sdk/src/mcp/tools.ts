/**
 * MCP tool registry — declarative list. Adding a tool = appending one entry.
 *
 * Schema follows the MCP `tools/list` contract (name, description, inputSchema).
 * `paid` triggers the `-32402 Payment Required` envelope in the dispatch layer
 * (see `server.ts`). `_meta` annotations are echoed verbatim to the client so
 * agent hosts can introspect price + KYA-tier requirements without calling.
 *
 * Post-Sui: every tool is Fhenix-tier. MemWal/Walrus/Sui-specific tools (the
 * `memwal_*`, `openx_memwal_*`, `openx_brain_restore`, `openx_brain_cost`
 * trustless tools) are removed.
 */

import type { OpenXClient, MemoryId } from '../openx';
import { AUTH_HEADER } from '../constants';

export interface PaymentEnvelope {
  rail: 'x402';
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
  // ─── Brain primitives — direct OpenXClient methods ─────────────────────
  {
    name: 'openx_brain_search',
    description: 'Semantic search across published OpenX brains. Free.',
    paid: false,
    inputSchema: {
      type: 'object',
      properties: { query: tStr, topK: tInt },
      required: ['query'],
    },
    handler: async ({ openx, args }) =>
      openx.recall(args.query as string, { topK: args.topK as number }),
  },
  {
    name: 'openx_brain_remember',
    description: 'Store text into the caller-owned brain (requires owner key).',
    paid: false,
    inputSchema: {
      type: 'object',
      properties: { text: tStr, namespace: tStr },
      required: ['text'],
    },
    handler: async ({ openx, args }) => ({
      memoryId: await openx.remember(args.text as string, {
        namespace: args.namespace as string,
      }),
    }),
  },
  {
    name: 'openx_brain_ask',
    description: 'Paid LLM-answered query with cited memories + TEE attestation.',
    paid: true,
    inputSchema: {
      type: 'object',
      properties: { query: tStr, topK: tInt },
      required: ['query'],
    },
    _meta: { 'x-x402': { method: 'x402', currency: 'USDC' } },
    handler: async ({ openx, args }) =>
      openx.ask(args.query as string, { topK: args.topK as number }),
  },

  // ─── Marketplace tools — agent-callable surface ────────────────────────
  {
    name: 'openx_marketplace_search',
    description:
      'Search the OpenX agent marketplace. Returns LLM-ranked agents with score, reason, and pricing.',
    paid: false,
    inputSchema: {
      type: 'object',
      properties: { query: tStr, domain: tStr, max: tInt },
      required: ['query'],
    },
    handler: async ({ openx, args }) => {
      const message = String(args.query ?? '').trim();
      if (!message) return { candidates: [], bundle: null };
      const max =
        typeof args.max === 'number' ? Math.min(Math.max(args.max, 1), 5) : 5;
      const res = (await openxApiFetch(openx, '/v3/discover', 'POST', {
        message,
        max_steps: max,
      })) as {
        candidates?: Array<{
          agent_id: string;
          score: number;
          reason: string;
          pricing: Record<string, string | null>;
          domain?: string;
        }>;
        bundle?: unknown;
      };
      const domain = typeof args.domain === 'string' ? args.domain : null;
      const candidates = (res?.candidates ?? []).filter((c) =>
        domain ? c.domain === domain : true,
      );
      return { candidates, bundle: res?.bundle ?? null };
    },
  },
  {
    name: 'openx_agent_invoke',
    description:
      'Invoke a published OpenX marketplace agent. Returns -32402 with x-payment-info on first call; pay then retry.',
    paid: true,
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: tStr,
        slug: tStr,
        input: { type: 'object' },
      },
      required: ['input'],
    },
    _meta: { 'x-x402': { method: 'x402', currency: 'USDC' } },
    handler: async ({ openx, args }) => {
      const id = (args.agent_id ?? args.slug) as string | undefined;
      if (!id) throw new Error('agent_id or slug required');
      const input = (args.input ?? {}) as Record<string, unknown>;
      const message =
        typeof input.q === 'string'
          ? input.q
          : typeof input.message === 'string'
          ? input.message
          : JSON.stringify(input);
      return openxApiFetch(
        openx,
        `/v3/agents/${encodeURIComponent(id)}/chat`,
        'POST',
        { message },
      );
    },
  },
  {
    name: 'openx_seller_publish',
    description:
      'Publish a new agent listing on OpenX using a scoped onboard token. ' +
      'Mint the token at /docs while logged in (15-min, single-use). Returns the ' +
      'agent_id, slug, and listing_url.',
    paid: false,
    inputSchema: {
      type: 'object',
      properties: {
        listing: {
          type: 'object',
          description:
            'SellerPublishInput — title, short_description, domain, persona_system_prompt, ' +
            'pricing_amount_usdc, pricing_rails (default: ["x402"]), and optional fields.',
        },
        onboard_permit: {
          type: 'string',
          description:
            'Wallet-signed onboard token (the value /docs prints into the canonical prompt). ' +
            'Sent as x-openx-token header. Single-use; valid 15 min.',
        },
      },
      required: ['listing', 'onboard_permit'],
    },
    handler: async ({ openx, args }) => {
      const permit = String(args.onboard_permit ?? '');
      if (permit.length < 100) throw new Error('onboard_permit missing or too short');
      const listing = (args.listing ?? {}) as Record<string, unknown>;
      return openxApiFetch(openx, '/v3/marketplace/seller/publish', 'POST', listing, {
        [AUTH_HEADER]: permit,
      });
    },
  },
];

// Re-export MemoryId so MCP consumers don't need a second import.
export type { MemoryId };

// ─── Generic OpenX API helper ───────────────────────────────────────────
// SOLID: one function, one concern, one error envelope. Errors carry HTTP
// status so the JSON-RPC mapper in server.ts translates 402/429/503 etc.
async function openxApiFetch(
  openx: OpenXClient,
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<unknown> {
  const apiUrl = (openx as unknown as { apiUrl?: string }).apiUrl ?? '';
  const wallet = (openx as unknown as { walletAddress?: string }).walletAddress;
  const url = new URL(path, apiUrl || 'http://localhost:3001');
  const headers: Record<string, string> = {};
  if (wallet) headers['x-wallet-address'] = wallet;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (extraHeaders) Object.assign(headers, extraHeaders);
  const r = await fetch(url.toString(), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json: unknown = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: text.slice(0, 200) };
    }
  }
  if (!r.ok) {
    const j = json as { error?: string; code?: string };
    const err = new Error(j?.error ?? `HTTP ${r.status}`) as Error & {
      code?: string;
      status?: number;
    };
    err.code = j?.code;
    err.status = r.status;
    throw err;
  }
  return json;
}
