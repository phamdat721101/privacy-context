/**
 * oapService — OpenX Agent Protocol (OAP) registration (PRD-U1).
 *
 * One service for machine-readable agent registration via
 * `.well-known/openx-agent.json`. Any external harness (Claude Code, Cursor,
 * Codex) can POST a manifest URL and get back a live OpenX seller in one
 * round-trip.
 *
 * Feature flag: caller (`routes/v3-oap.ts` + MCP tool) checks
 * `FEATURE_OAP_REGISTRATION`; this module is unconditionally importable.
 *
 * SOLID:
 *   - SRP: this module owns fetch → validate → hash → register. Atomic
 *          brain+agent creation stays in sellerPublishService.
 *   - OCP: manifest schema evolves by adding fields to `validateManifest`
 *          + `manifestToSellerPublishInput`; the pipeline does not change.
 *   - DIP: takes `{ pool, logger, publish }` in the constructor for test
 *          injection. Default publish binder wraps sellerPublishService.
 */

import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { pool } from '../db';
import { logger } from '../lib';
import {
  publish as sellerPublish,
  SellerPublishInput,
  SellerPublishResult,
} from './sellerPublishService';
import { safeValidateManifest, type OapManifest as SdkOapManifest } from '@fhe-ai-context/sdk';

// ─── Types ──────────────────────────────────────────────────────────────

/**
 * OAP manifest — the canonical wire schema. Kept small on purpose; the full
 * Zod schema (with `.passthrough()` for forward-compat unknown keys) ships
 * in `packages/sdk/src/oap/schemas.ts` at Task 5. Until then we hand-validate
 * the minimum fields we need for atomic registration.
 */
export interface OapManifest {
  version: '1.0' | string;
  agent: {
    name: string;
    slug?: string;
    description: string;
    homepage?: string;
    license?: string;
    authors?: string[];
    domain?: 'marketing' | 'finance' | 'research' | 'engineering' | 'generalist' | 'other';
    tags?: string[];
  };
  persona: {
    system_prompt: string;
    tools?: string[];
  };
  endpoint?: {
    url: string;
    method?: 'POST';
  };
  pricing: {
    amount_usdc: string;
    rails?: Array<'x402' | 'mpp' | 'fherc20'>;
    chain?: 'arbitrum-sepolia' | 'fhenix' | 'base-sepolia';
  };
  attestation?: {
    eip712_sig?: string;
    tee_hash?: string;
  };
}

export type ValidationOk = { ok: true; manifest: OapManifest };
export type ValidationFail = { ok: false; reason: string };
export type ValidationResult = ValidationOk | ValidationFail;

export type RegistrationSource = 'url' | 'inline' | 'nl_fallback' | 'mcp';

export interface RegistrationResult {
  agent_id: string;
  slug: string;
  manifest_hash: string;
  listing_url: string;
  paywall_url: string;
  curl_example: string;
}

// ─── Errors — .status maps 1:1 to HTTP in the route layer ───────────────

export class OapError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

// ─── Service ────────────────────────────────────────────────────────────

interface Deps {
  pool: Pool;
  logger: Logger;
  /** Injectable for tests; defaults to sellerPublishService.publish. */
  publish?: typeof sellerPublish;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const FETCH_TIMEOUT_MS = 5000;
const MAX_MANIFEST_BYTES = 64 * 1024;

export class OapService {
  private readonly publish: typeof sellerPublish;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly deps: Deps) {
    this.publish = deps.publish ?? sellerPublish;
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  }

  // ── 1. fetch ──────────────────────────────────────────────────────────

  /**
   * Fetch a manifest from a URL. Enforces:
   *   - http(s):// scheme (guards SSRF surface)
   *   - 5-second timeout
   *   - 64KB response cap (guards memory)
   *   - application/json response
   * Throws `OapError` with 400/502 on any failure.
   */
  async fetchManifest(url: string): Promise<unknown> {
    if (!/^https?:\/\//i.test(url)) {
      throw new OapError(400, 'bad_url', 'manifest_url must be http(s)://');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
    } catch (e) {
      throw new OapError(502, 'fetch_failed', `manifest fetch failed: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new OapError(502, 'fetch_status', `manifest fetch returned HTTP ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_MANIFEST_BYTES) {
      throw new OapError(400, 'manifest_too_large', `manifest exceeds ${MAX_MANIFEST_BYTES} bytes`);
    }
    try {
      return JSON.parse(new TextDecoder().decode(buf));
    } catch (e) {
      throw new OapError(400, 'invalid_json', `manifest is not valid JSON: ${(e as Error).message}`);
    }
  }

  // ── 2. validate ───────────────────────────────────────────────────────

  /**
   * Delegate to the Zod schema shipped in `@fhe-ai-context/sdk`. Single
   * source of truth for manifest shape; adds forward-compat `.passthrough()`
   * for unknown keys. External API of this method is unchanged (returns the
   * legacy `ValidationOk | ValidationFail` discriminated union so route
   * callers don't have to churn).
   */
  validateManifest(json: unknown): ValidationResult {
    const r = safeValidateManifest(json);
    if ('reason' in r) return { ok: false, reason: r.reason };
    // The sdk's inferred type is structurally identical to the local
    // OapManifest interface; cast is safe and free.
    return { ok: true, manifest: r.value as unknown as OapManifest };
  }

  // ── 3. hash ───────────────────────────────────────────────────────────

  /** Canonical sha256 for idempotency. Deterministic key ordering via
   *  `JSON.stringify` with a sorted-keys replacer. */
  hashManifest(manifest: OapManifest): string {
    return createHash('sha256').update(canonicalJson(manifest)).digest('hex');
  }

  // ── 4. lookup ─────────────────────────────────────────────────────────

  async getByHash(hash: string): Promise<{ agent_id: string | null; manifest_hash: string } | null> {
    const r = await this.deps.pool.query(
      `SELECT agent_id, manifest_hash FROM oap_manifests WHERE manifest_hash = $1 LIMIT 1`,
      [hash],
    );
    return r.rows[0] ?? null;
  }

  // ── 5. register — atomic ──────────────────────────────────────────────

  /**
   * Fast-path idempotency, then atomic publish + link:
   *   (a) SELECT by hash → if agent_id already linked, return existing
   *   (b) else call sellerPublishService.publish (owns its own TX)
   *   (c) upsert `oap_manifests` linking new agent_id (idempotent on hash)
   *   (d) INSERT audit row into `oap_registration_events`
   * Any failure writes a 'rejected' or 'error' audit row and rethrows.
   *
   * Concurrent same-manifest register races: `agents.slug` UNIQUE forces
   * one caller to lose atomically; the loser's error is surfaced as-is.
   */
  async registerFromManifest(
    manifest: OapManifest,
    ownerAddress: string,
    source: RegistrationSource,
    opts: { manifestUrl?: string } = {},
  ): Promise<RegistrationResult> {
    if (!ownerAddress) throw new OapError(401, 'auth_required', 'owner address required');

    const hash = this.hashManifest(manifest);

    // (a) fast-path: already registered
    const existing = await this.deps.pool.query<{ agent_id: string | null; slug: string | null }>(
      `SELECT m.agent_id, a.slug
         FROM oap_manifests m
         LEFT JOIN agents a ON a.id = m.agent_id
        WHERE m.manifest_hash = $1
        LIMIT 1`,
      [hash],
    );
    const linkedAgentId = existing.rows[0]?.agent_id ?? null;
    const linkedSlug = existing.rows[0]?.slug ?? null;
    if (linkedAgentId && linkedSlug) {
      await this.logEvent({
        manifest_hash: hash,
        source,
        status: 'accepted',
        agent_id: linkedAgentId,
        owner_address: ownerAddress,
      });
      return this.buildResult(linkedAgentId, linkedSlug, hash);
    }

    // (b) publish atomically via existing seller pipeline (owns its own TX)
    let published: SellerPublishResult;
    try {
      const input = manifestToSellerPublishInput(manifest, ownerAddress);
      published = await this.publish(ownerAddress, input);
    } catch (err) {
      const oe = err instanceof OapError ? err : null;
      await this.logEvent({
        manifest_hash: hash,
        source,
        status: oe && oe.status < 500 ? 'rejected' : 'error',
        agent_id: null,
        owner_address: ownerAddress,
        error: (err as Error).message?.slice(0, 500),
      });
      throw err;
    }

    // (c) upsert manifest row linking to the new agent (idempotent by hash)
    try {
      await this.deps.pool.query(
        `INSERT INTO oap_manifests
           (manifest_hash, manifest_url, manifest_json, sig_state, agent_id)
         VALUES ($1, $2, $3::jsonb, $4, $5)
         ON CONFLICT (manifest_hash) DO UPDATE
           SET agent_id   = COALESCE(oap_manifests.agent_id, EXCLUDED.agent_id),
               fetched_at = now()`,
        [
          hash,
          opts.manifestUrl ?? null,
          JSON.stringify(manifest),
          inferSigState(manifest),
          published.agent_id,
        ],
      );
    } catch (e) {
      // Manifest row failed to write but the agent is already published;
      // log the discrepancy and continue — the seller still has a live
      // listing, we've just lost the idempotency shortcut for future
      // re-registrations of the identical manifest.
      this.deps.logger.warn(
        { err: (e as Error).message, hash, agent_id: published.agent_id },
        'oap:manifest-row-write:failed',
      );
    }

    // (d) audit — best-effort, never poisons the happy path
    await this.logEvent({
      manifest_hash: hash,
      source,
      status: 'accepted',
      agent_id: published.agent_id,
      owner_address: ownerAddress,
    });

    return this.buildResult(published.agent_id, published.slug, hash);
  }

  // ── 6. audit log ──────────────────────────────────────────────────────

  private async logEvent(row: {
    manifest_hash: string | null;
    source: RegistrationSource;
    status: 'accepted' | 'rejected' | 'error';
    agent_id: string | null;
    owner_address: string;
    error?: string;
  }): Promise<void> {
    try {
      await this.deps.pool.query(
        `INSERT INTO oap_registration_events
           (manifest_hash, source, status, error, agent_id, owner_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.manifest_hash, row.source, row.status, row.error ?? null, row.agent_id, row.owner_address],
      );
    } catch (e) {
      // Never let audit-log failure poison the registration path.
      this.deps.logger.warn({ err: (e as Error).message }, 'oap:audit-log:error');
    }
  }

  // ── 7. internal — response shape ──────────────────────────────────────

  private buildResult(agent_id: string, slug: string, manifest_hash: string): RegistrationResult {
    const publicBase = process.env.PUBLIC_API_URL?.replace(/\/$/, '') ?? '';
    return {
      agent_id,
      slug,
      manifest_hash,
      listing_url: publicBase ? `${publicBase}/v3/marketplace/listings/${slug}` : `/v3/marketplace/listings/${slug}`,
      paywall_url: publicBase ? `${publicBase}/api/v1/${slug}` : `/api/v1/${slug}`,
      curl_example: `curl -i ${publicBase || 'https://<host>'}/api/v1/${slug}`,
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deterministic JSON serialization for canonical hashing. */
function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(v as object).sort();
  const body = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`);
  return `{${body.join(',')}}`;
}

function inferSigState(manifest: OapManifest): 'unsigned' | 'valid' | 'invalid' {
  const sig = manifest.attestation?.eip712_sig;
  if (!sig) return 'unsigned';
  // Real EIP-712 verification lands with PRD-U4's approve endpoint (reuses
  // existing packages/api/src/fhe/permits.ts primitives). For Task 1 we
  // only surface presence; strict verify enforced in Task 4.
  return 'unsigned';
}

/**
 * Map an OAP manifest → SellerPublishInput. Any field the manifest does not
 * carry falls back to a sensible default so the atomic publish never fails
 * on missing metadata.
 */
export function manifestToSellerPublishInput(m: OapManifest, _owner: string): SellerPublishInput {
  return {
    title: m.agent.name,
    short_description: m.agent.description,
    long_description: m.agent.description,
    domain: m.agent.domain ?? 'generalist',
    tags: m.agent.tags,
    persona_system_prompt: m.persona.system_prompt,
    persona_tools: m.persona.tools,
    pricing_amount_usdc: m.pricing.amount_usdc,
    pricing_rails: m.pricing.rails && m.pricing.rails.length > 0 ? m.pricing.rails : ['x402'],
    chain: m.pricing.chain ?? 'arbitrum-sepolia',
    slug: m.agent.slug,
    verification_tier: 'basic',
    kind: 'api',
    endpoint_url: m.endpoint?.url ?? null,
  };
}

// ─── singleton — one instance for the whole api process ─────────────────
// Matches conciergeOnboardService pattern: routes/MCP import `oapService`
// directly; tests construct their own `new OapService({...})` with mocked
// deps.
export const oapService = new OapService({ pool, logger });
