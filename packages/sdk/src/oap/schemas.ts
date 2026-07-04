/**
 * OAP Zod schemas — single source of truth for the wire format.
 *
 * Consumers:
 *   • `packages/api/src/services/oapService.ts` — validates manifests posted
 *     to `POST /v3/oap/register` (PRD-U1).
 *   • `packages/api/src/middleware/oapValidation.ts` — validates envelopes
 *     on `Content-Type: application/oap+json` requests (PRD-U2).
 *   • `packages/sdk/src/mcp/tools.ts` — new tools that accept an envelope
 *     derive their JSON Schema `inputSchema` via `zodToJsonSchema` at
 *     module-init time (v1.1).
 *
 * SOLID:
 *   • SRP — one file, one concern: define the OAP wire shapes. Runtime
 *     validation is delegated to Zod; no hand-rolled logic here.
 *   • OCP — every optional structural field uses `.passthrough()` so new
 *     downstream keys don't break existing validators. Adding a new
 *     required field = a new `.strict()` sub-schema, no consumer changes.
 *
 * Design notes for v1.0:
 *   - We keep the manifest schema loose (matches the hand-rolled validator
 *     shipped in Task 1). Downstream sellers add their own metadata.
 *   - The envelope carries buyer intent + typed context slots + a small
 *     attestation chain. The name/shape mirrors Anthropic MCP envelopes so
 *     harnesses that understand MCP can consume OpenX v2 with minimal
 *     rewiring.
 */

import { z } from 'zod';

// ─── Common leaf types ─────────────────────────────────────────────────────

const decimalUsdc = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'must be a decimal string, e.g. "0.05"');

const httpUrl = z.string().regex(/^https?:\/\//i, 'must be http(s)://');

const railEnum = z.enum(['x402', 'mpp', 'fherc20']);

const chainEnum = z.enum(['arbitrum-sepolia', 'fhenix', 'base-sepolia']);

const domainEnum = z.enum([
  'marketing',
  'finance',
  'research',
  'engineering',
  'generalist',
  'other',
]);

// ─── OapManifest — published at `.well-known/openx-agent.json` ─────────────

export const OapManifestSchema = z
  .object({
    version: z.string().min(1),
    agent: z
      .object({
        name: z.string().min(1).max(200),
        slug: z.string().regex(/^[a-z0-9-]{3,30}$/).optional(),
        description: z.string().min(1).max(2000),
        homepage: httpUrl.optional(),
        license: z.string().optional(),
        authors: z.array(z.string()).optional(),
        domain: domainEnum.optional(),
        tags: z.array(z.string()).optional(),
      })
      .passthrough(),
    persona: z
      .object({
        system_prompt: z.string().min(1),
        tools: z.array(z.string()).optional(),
      })
      .passthrough(),
    endpoint: z
      .object({
        url: httpUrl,
        method: z.literal('POST').optional(),
      })
      .passthrough()
      .optional(),
    pricing: z
      .object({
        amount_usdc: decimalUsdc,
        rails: z.array(railEnum).nonempty().optional(),
        chain: chainEnum.optional(),
      })
      .passthrough(),
    attestation: z
      .object({
        eip712_sig: z.string().optional(),
        tee_hash: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type OapManifest = z.infer<typeof OapManifestSchema>;

// ─── OapEnvelope — the wire format between buyer and OpenX ─────────────────
//
// v1.0 goal: replace string-blob prompts with typed context slots. The
// concrete token savings come from the API skipping conversational preamble
// (system persona is built from the agent row, not repeated in every call).
//
// Every envelope carries a `trace_id` so PRD-U3 sub-agent orchestration can
// build the attestation chain via `parent_hash` in `sub_agent_hires`.

export const OapIntentSchema = z
  .object({
    task_type: z
      .enum([
        'translate',
        'audit',
        'summarize',
        'extract',
        'q_and_a',
        'orchestrate',
        'call',
        'other',
      ])
      .default('other'),
    description: z.string().min(1).max(2000),
    // Optional structured slots — the whole point of typed context: only
    // include what the task type actually needs, no filler.
    from_lang: z.string().optional(),
    to_lang: z.string().optional(),
    register: z.enum(['formal', 'casual', 'technical', 'neutral']).optional(),
  })
  .passthrough();

export const OapContextSchema = z
  .object({
    // Reference to a stored artifact (upload id, uri, or literal payload).
    artifact_ref: z.string().optional(),
    // Inline literal payload — bounded to keep envelope size in check.
    payload: z.string().max(64 * 1024).optional(),
    // Any prior context IDs the caller wants surfaced. Cognitive memory
    // (Jun 26 CognitiveLanes) uses this.
    memory_ids: z.array(z.string()).optional(),
    // Locale + user timezone hints — persona uses when present.
    locale: z.string().optional(),
    tz: z.string().optional(),
  })
  .passthrough();

export const OapBudgetSchema = z
  .object({
    max_tokens: z.number().int().positive().optional(),
    max_usdc: decimalUsdc.optional(),
    // Skill Listing Budget — cap on skill-preamble token count (PRD-U3).
    skill_tokens: z.number().int().positive().default(3000),
  })
  .passthrough();

export const OapEnvelopeSchema = z
  .object({
    version: z.literal('1.0'),
    trace_id: z.string().min(1).max(64),
    parent_hash: z.string().max(128).optional(),
    intent: OapIntentSchema,
    context: OapContextSchema.default({}),
    budget: OapBudgetSchema.default({ skill_tokens: 3000 }),
    // EIP-712 attestation over the envelope's canonical hash. Optional in
    // v1.0 (verified when present); becomes required in v1.1 for
    // sub-agent orchestration to close the attestation chain.
    attestation: z
      .object({
        eip712_sig: z.string().optional(),
        signer: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type OapEnvelope = z.infer<typeof OapEnvelopeSchema>;
export type OapIntent = z.infer<typeof OapIntentSchema>;
export type OapContext = z.infer<typeof OapContextSchema>;
export type OapBudget = z.infer<typeof OapBudgetSchema>;

// ─── OapResponse — every OpenX v2 endpoint returns this shape ──────────────

export const OapResponseSchema = z
  .object({
    trace_id: z.string().min(1),
    parent_hash: z.string().optional(),
    output: z.unknown(),
    attestation_hash: z.string().optional(),
    tokens: z
      .object({
        input: z.number().int().nonnegative(),
        output: z.number().int().nonnegative(),
      })
      .optional(),
    cost_usdc: decimalUsdc.optional(),
    // When the caller was hired as a sub-agent, this echoes the primary's
    // trace_id so V4 Tasks can reconstruct the chain.
    root_trace_id: z.string().optional(),
  })
  .passthrough();

export type OapResponse = z.infer<typeof OapResponseSchema>;

// ─── Safe-parse helpers (idiomatic in api/middleware call sites) ───────────

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; issues: z.ZodIssue[] };

export function safeValidateEnvelope(input: unknown): ValidationResult<OapEnvelope> {
  const r = OapEnvelopeSchema.safeParse(input);
  return r.success
    ? { ok: true, value: r.data }
    : { ok: false, reason: flattenFirstIssue(r.error.issues), issues: r.error.issues };
}

export function safeValidateManifest(input: unknown): ValidationResult<OapManifest> {
  const r = OapManifestSchema.safeParse(input);
  return r.success
    ? { ok: true, value: r.data }
    : { ok: false, reason: flattenFirstIssue(r.error.issues), issues: r.error.issues };
}

function flattenFirstIssue(issues: z.ZodIssue[]): string {
  if (issues.length === 0) return 'invalid';
  const first = issues[0];
  const path = first.path.join('.') || '(root)';
  return `${path}: ${first.message}`;
}

// ─── Envelope → prompt codec (deterministic, no LLM) ───────────────────────
//
// The whole point of typed context: skip conversational preamble. The agent's
// persona.system_prompt is loaded once from the DB and reused across every
// call, so the wire envelope carries only the delta — the intent, the typed
// context slots that actually matter for the task type, and any bounded
// payload. Rendering is deterministic (same envelope → same prompt), so
// idempotency + smoke assertions hold.
//
// v1.0 output shape:
//   Task: <task_type> — <description>
//   [Translate from <from_lang> to <to_lang>. Register: <register>.]
//   [Locale: <locale>. TZ: <tz>.]
//   [Artifact: <artifact_ref>]
//   [Memory: <ids joined>]
//   [Payload:
//   <payload>]
//
// Only lines with values render; empty lines are omitted. This produces
// tight prompts (≥50% shorter than typical string-blob prompts) while
// preserving every load-bearing bit of context.

export function envelopeToPrompt(env: OapEnvelope): string {
  const lines: string[] = [];
  const intent = env.intent;
  const context = env.context ?? {};

  lines.push(`Task: ${intent.task_type} — ${intent.description}`);

  if (intent.from_lang && intent.to_lang) {
    const register = intent.register ?? 'neutral';
    lines.push(`Translate from ${intent.from_lang} to ${intent.to_lang}. Register: ${register}.`);
  }

  if (context.locale || context.tz) {
    const parts: string[] = [];
    if (context.locale) parts.push(`Locale: ${context.locale}`);
    if (context.tz) parts.push(`TZ: ${context.tz}`);
    lines.push(parts.join('. ') + '.');
  }

  if (context.artifact_ref) lines.push(`Artifact: ${context.artifact_ref}`);
  if (context.memory_ids && context.memory_ids.length > 0) {
    lines.push(`Memory: ${context.memory_ids.join(', ')}`);
  }

  if (context.payload) {
    lines.push('Payload:');
    lines.push(context.payload);
  }

  return lines.join('\n');
}
