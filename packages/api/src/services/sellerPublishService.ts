import { createHash } from 'node:crypto';
import { pool } from '../db';

/**
 * sellerPublishService — atomic seller publish.
 *
 * One Postgres transaction: brain INSERT → manifest render → agent INSERT.
 * Returns slug + listing_url + tier-aware knowledge_url + mcp_invoke_snippet
 * so the wizard's success card can deeplink without a second round-trip.
 *
 * SOLID:
 *   - SRP: this module owns "create brain + agent + publish" as one unit.
 *          CRUD on individual resources stays in their existing routes.
 *   - DIP: pool is module-level (matches the rest of services/*); a
 *          transactional client is acquired via pool.connect() so the
 *          INSERTs roll back together on any failure.
 *   - OCP: adding a new manifest field = one validator entry + one renderer
 *          line; the pipeline does not change.
 */

export type Domain =
  | 'marketing'
  | 'finance'
  | 'research'
  | 'engineering'
  | 'generalist'
  | 'other';

export type Tier = 'basic' | 'verified' | 'tee_attested';

export type Rail = 'x402' | 'mpp' | 'sui_usdc' | 'fherc20';

export type Chain =
  | 'arbitrum-sepolia'
  | 'fhenix'
  | 'base-sepolia'
  | 'sui'
  | 'sui-testnet'
  | 'sui-mainnet';

export interface SellerPublishInput {
  title: string;
  short_description: string;
  long_description?: string;
  domain: Domain;
  tags?: string[];
  persona_system_prompt: string;
  persona_tools?: string[];
  pricing_amount_usdc: string;
  pricing_rails: Rail[];
  chain?: Chain;
  slug?: string;
  verification_tier?: Tier;
  /**
   * When true, also expose the `fherc20` (Fhenix confidential-amount) rail
   * at the same price. Reuses the shipped useFherc20Pay + fherc20Verifier
   * stack — no new payment infra.
   */
  accept_private_payment?: boolean;
}

export interface SellerPublishResult {
  agent_id: string;
  brain_id: number;
  slug: string;
  domain: Domain;
  verification_tier: Tier;
  chain: Chain;
  listing_url: string;
  /** Tier-aware deeplink to the post-publish knowledge upload page. */
  knowledge_url: string | null;
  mcp_invoke_snippet: string;
  manifest_yaml: string;
}

const DOMAINS: Domain[] = [
  'marketing',
  'finance',
  'research',
  'engineering',
  'generalist',
  'other',
];

const RAILS: Rail[] = ['x402', 'mpp', 'sui_usdc', 'fherc20'];

const TIERS: Tier[] = ['basic', 'verified', 'tee_attested'];

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,40}$/;

const CHAINS: Chain[] = [
  'arbitrum-sepolia',
  'fhenix',
  'base-sepolia',
  'sui',
  'sui-testnet',
  'sui-mainnet',
];

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'agent'
  );
}

/** Lift a thrown Error to carry an HTTP-style status code. */
function httpErr(message: string, status: number): Error {
  const e = new Error(message) as Error & { status?: number };
  e.status = status;
  return e;
}

function validate(input: SellerPublishInput): void {
  if (!input.title || input.title.length < 3 || input.title.length > 120) {
    throw httpErr('title must be 3..120 chars', 400);
  }
  if (
    !input.short_description ||
    input.short_description.length < 10 ||
    input.short_description.length > 240
  ) {
    throw httpErr('short_description must be 10..240 chars', 400);
  }
  if (!DOMAINS.includes(input.domain)) {
    throw httpErr(`invalid domain (allowed: ${DOMAINS.join(', ')})`, 400);
  }
  if (input.tags && input.tags.length > 10) {
    throw httpErr('at most 10 tags', 400);
  }
  if (
    !input.persona_system_prompt ||
    input.persona_system_prompt.trim().length < 10
  ) {
    throw httpErr('persona_system_prompt must be ≥10 chars', 400);
  }
  if (input.persona_tools && input.persona_tools.length > 10) {
    throw httpErr('at most 10 persona_tools', 400);
  }
  const amount = Number(input.pricing_amount_usdc);
  if (!(amount > 0 && amount <= 1000)) {
    throw httpErr('pricing_amount_usdc must be in (0, 1000]', 400);
  }
  if (!Array.isArray(input.pricing_rails) || input.pricing_rails.length === 0) {
    throw httpErr('pricing_rails must be non-empty', 400);
  }
  for (const r of input.pricing_rails) {
    if (!RAILS.includes(r)) throw httpErr(`invalid rail: ${r}`, 400);
  }
  if (input.slug !== undefined && !SLUG_RE.test(input.slug)) {
    throw httpErr('slug must match ^[a-z0-9][a-z0-9-]{2,40}$', 400);
  }
  if (input.verification_tier && !TIERS.includes(input.verification_tier)) {
    throw httpErr(`invalid verification_tier (allowed: ${TIERS.join(', ')})`, 400);
  }
  if (input.chain && !CHAINS.includes(input.chain)) {
    throw httpErr(`invalid chain (allowed: ${CHAINS.join(', ')})`, 400);
  }
}

/**
 * Render the canonical YAML manifest. Hash-stable (same input → same hash)
 * so re-publishing without changes produces an idempotent manifest_hash.
 *
 * v1 supports `type: agent` only; workflow + skill ship in v1.5.
 */
function renderManifest(
  input: SellerPublishInput,
  slug: string,
  owner: string,
  pricingRails: Rail[],
): string {
  const tier = input.verification_tier ?? 'basic';
  const tags = (input.tags ?? []).map((t) => `'${t.replace(/'/g, '')}'`).join(', ');
  const tools = (input.persona_tools ?? [])
    .map((t) => `'${t.replace(/'/g, '')}'`)
    .join(', ');
  const rails = pricingRails.map((r) => `'${r}'`).join(', ');
  return [
    `manifest_version: '1.0'`,
    `listing:`,
    `  type: agent`,
    `  slug: ${slug}`,
    `  title: ${JSON.stringify(input.title)}`,
    `  short: ${JSON.stringify(input.short_description)}`,
    `  domain: ${input.domain}`,
    `  tags: [${tags}]`,
    `owner:`,
    `  wallet_address: '${owner}'`,
    `pricing:`,
    `  mode: fixed`,
    `  amount_usdc: '${input.pricing_amount_usdc}'`,
    `  currency: USDC`,
    `  rails: [${rails}]`,
    `verification:`,
    `  tier: ${tier}`,
    `persona:`,
    `  system_prompt: ${JSON.stringify(input.persona_system_prompt)}`,
    `  tools: [${tools}]`,
    ``,
  ].join('\n');
}

/**
 * Tier-aware knowledge upload URL. Standard tier (Fhenix on Arbitrum/Base)
 * routes to /brain; Trustless tier (Sui + Walrus + MemWal) routes to
 * /brain-sui/<id>. Returned in the publish result so the wizard's success
 * card deeplinks without a second round-trip.
 */
function knowledgeUrlFor(chain: Chain, brainId: number, baseUrl: string): string | null {
  if (chain === 'arbitrum-sepolia' || chain === 'fhenix' || chain === 'base-sepolia') {
    return `${baseUrl}/brain?id=${brainId}`;
  }
  if (chain === 'sui' || chain === 'sui-testnet' || chain === 'sui-mainnet') {
    return `${baseUrl}/brain-sui/${brainId}`;
  }
  return null;
}

function mcpInvokeSnippet(slug: string, agentId: string, apiBaseUrl: string): string {
  return [
    `// Pay-per-call from any MCP host (Claude / Cursor / Codex / AgentCash):`,
    `await mcp.call('openx_agent_invoke', {`,
    `  slug: '${slug}',`,
    `  input: { q: 'your question here' },`,
    `});`,
    ``,
    `// Direct HTTP (raw 402 challenge):`,
    `// curl -X POST ${apiBaseUrl}/v3/agents/${agentId}/chat \\`,
    `//   -H 'content-type: application/json' \\`,
    `//   -d '{"message":"your question here"}'`,
  ].join('\n');
}

export async function publish(
  walletAddress: string,
  input: SellerPublishInput,
  opts?: { apiBaseUrl?: string },
): Promise<SellerPublishResult> {
  validate(input);

  const owner = walletAddress.toLowerCase();
  const slug = input.slug ?? slugify(input.title);
  const tier: Tier = input.verification_tier ?? 'basic';
  const chain: Chain = input.chain ?? 'arbitrum-sepolia';
  const tags = input.tags ?? [];
  const apiBase = opts?.apiBaseUrl ?? '';

  // Build pricing JSONB. Every rail starts null; selected rails carry the
  // single price. fherc20 (Fhenix confidential-amount) is opt-in via the
  // accept_private_payment flag OR explicit inclusion in pricing_rails.
  const railsSet = new Set<Rail>(input.pricing_rails);
  if (input.accept_private_payment) railsSet.add('fherc20');
  const railsArr = Array.from(railsSet);
  const pricing: Record<Rail, string | null> = {
    x402: null,
    mpp: null,
    sui_usdc: null,
    fherc20: null,
  };
  for (const r of railsArr) pricing[r] = input.pricing_amount_usdc;

  const persona = {
    system_prompt: input.persona_system_prompt.trim(),
    tools: input.persona_tools ?? [],
  };

  const manifestYaml = renderManifest(input, slug, owner, railsArr);
  const manifestHash = createHash('sha256').update(manifestYaml).digest();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const brainRes = await client.query(
      `INSERT INTO brains (owner_address, title, description, tags, published, chain)
       VALUES ($1, $2, $3, $4, true, $5)
       RETURNING id`,
      [
        owner,
        input.title,
        input.long_description ?? input.short_description,
        tags,
        chain,
      ],
    );
    const brainId = brainRes.rows[0].id as number;

    const agentRes = await client.query(
      `INSERT INTO agents (
         brain_id, owner_address, chain, persona, pricing,
         kya_required, min_reputation, published, slug,
         domain, short_description, verification_tier, manifest_yaml, manifest_hash
       )
       VALUES (
         $1, $2, $3, $4::jsonb, $5::jsonb,
         false, 0, true, $6,
         $7, $8, $9, $10, $11
       )
       RETURNING id`,
      [
        brainId,
        owner,
        chain,
        JSON.stringify(persona),
        JSON.stringify(pricing),
        slug,
        input.domain,
        input.short_description,
        tier,
        manifestYaml,
        manifestHash,
      ],
    );
    const agentId = agentRes.rows[0].id as string;

    await client.query('COMMIT');

    return {
      agent_id: agentId,
      brain_id: brainId,
      slug,
      domain: input.domain,
      verification_tier: tier,
      chain,
      listing_url: `${apiBase}/agent/${slug}`,
      knowledge_url: knowledgeUrlFor(chain, brainId, apiBase),
      mcp_invoke_snippet: mcpInvokeSnippet(slug, agentId, apiBase),
      manifest_yaml: manifestYaml,
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    const err = e as { code?: string; constraint?: string; message?: string };
    if (
      err?.code === '23505' &&
      /agents_slug_key|agents_slug/.test(String(err?.constraint ?? err?.message ?? ''))
    ) {
      throw httpErr('slug already taken', 409);
    }
    throw e;
  } finally {
    client.release();
  }
}
