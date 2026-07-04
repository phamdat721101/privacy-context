/**
 * agentOrchestrationService — PRD-U3 skill autoloader + sub-agent orchestrator.
 *
 * Three SRP methods, one class, one file (per user simplification 2=b):
 *
 *   • loadSkills()     — deterministic typed-trigger matching + budget-packing.
 *                        Same envelope → same skill set. Replaces the Jul 3
 *                        substring `pickDynamicSkillPrompt` when
 *                        FEATURE_SKILL_AUTOLOADER=true.
 *
 *   • pickCandidate()  — claw-router-inspired policy engine. 5 policies:
 *                        round-robin, lru, usage-aware, cost-aware,
 *                        reputation-aware. Reads agent_router_policies.
 *
 *   • orchestrate()    — LLM-decomposer (Bedrock Claude) + fan-out sub-hires
 *                        + fan-in synthesis. Writes sub_agent_hires rows
 *                        with parent_hash attestation chain. Revenue split
 *                        20/75/5 (configurable via budget_split).
 *
 * Feature flags: caller checks `FEATURE_SKILL_AUTOLOADER` +
 * `FEATURE_SUB_AGENT_ORCHESTRATION`; this module is unconditionally
 * importable so tests can construct it without env setup.
 *
 * SOLID:
 *   • SRP — one file, three methods, each one job.
 *   • OCP — adding a router policy = one function; matcher accepts new
 *          pattern shapes via the same union.
 *   • DIP — { pool, logger, llmChat } injected in the constructor for tests.
 */

import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { pool } from '../db';
import { logger } from '../lib';
import { llmChat } from './chat';
import type { OapEnvelope, OapResponse } from '@fhe-ai-context/sdk';

// ─── Types ──────────────────────────────────────────────────────────────

/**
 * Typed trigger pattern. Legacy string values in `trigger_patterns` (Jul 3
 * substring style) are normalized at read-time to `{type: 'keyword'}` so
 * the migration script `scripts/migrate-triggers-to-typed.ts` is optional.
 */
export type TriggerPattern =
  | { type: 'keyword'; match: string[]; weight?: number }
  | { type: 'task_type'; match: string[]; weight?: number }
  | { type: 'regex'; pattern: string; flags?: string; weight?: number };

export interface LoadSkillsResult {
  /** '' when nothing matched — caller preserves persona.system_prompt as-is. */
  systemPromptPrefix: string;
  matchedSkills: string[];
  tokensUsed: number;
  budgetTokens: number;
}

export type RouterPolicy =
  | 'round-robin'
  | 'lru'
  | 'usage-aware'
  | 'cost-aware'
  | 'reputation-aware';

export interface Candidate {
  agent_id: string;
  slug: string;
  reputation_score?: number;
  cost_usdc?: string;
  last_hire_at?: string | null;
  active_hires?: number;
}

export interface OrchestrateOptions {
  /** How many sub-agents may be hired for this call (safety cap; default 3). */
  maxSubAgents?: number;
  /** Fallback to single-hop if decomposition fails (default true). */
  fallbackToSingleHop?: boolean;
  /** Override the default 20/75/5 revenue split. */
  budgetSplit?: { primary_bps: number; sub_bps: number; platform_bps: number };
}

export interface OrchestrationResult extends OapResponse {
  /** Sub-agent attestation hashes forming the chain. */
  sub_hires: Array<{ agent_id: string; attestation_hash: string; cost_usdc: string }>;
}

// ─── Service ────────────────────────────────────────────────────────────

interface Deps {
  pool: Pool;
  logger: Logger;
  /** Injectable for tests; defaults to real llmChat. */
  llmChat?: typeof llmChat;
}

const DEFAULT_BUDGET_TOKENS = 3000;
const DEFAULT_BUDGET_SPLIT = { primary_bps: 2000, sub_bps: 7500, platform_bps: 500 };

export class AgentOrchestrationService {
  private readonly llm: typeof llmChat;

  constructor(private readonly deps: Deps) {
    this.llm = deps.llmChat ?? llmChat;
  }

  // ── 1. loadSkills — Task 8 ────────────────────────────────────────────

  /**
   * Deterministic skill autoloader. Given an agent and a call context
   * (envelope OR raw message text), returns the concatenated system-prompt
   * prefix of matched skills, packed to fit within `budgetTokens`.
   *
   * Determinism guarantee: for a given (agentId, envelope) pair with the
   * same DB state, this function returns exactly the same output every
   * call. Ordering is by (score DESC, audit_score DESC, slug ASC) — the
   * slug tiebreak makes ordering stable across pg query plans.
   */
  async loadSkills(
    agentId: string,
    opts: { envelope?: OapEnvelope; messageText?: string; budgetTokens?: number } = {},
  ): Promise<LoadSkillsResult> {
    const budgetTokens = opts.budgetTokens ?? opts.envelope?.budget?.skill_tokens ?? DEFAULT_BUDGET_TOKENS;
    const empty: LoadSkillsResult = {
      systemPromptPrefix: '',
      matchedSkills: [],
      tokensUsed: 0,
      budgetTokens,
    };

    const messageText = (opts.envelope?.intent?.description ?? opts.messageText ?? '').trim();
    const taskType = opts.envelope?.intent?.task_type;
    if (!messageText && !taskType) return empty;

    const r = await this.deps.pool.query<{
      slug: string;
      system_prompt: string;
      trigger_patterns: unknown; // legacy TEXT[]-ish or typed jsonb array
      audit_score: number;
      skill_md_lines: number;
    }>(
      `SELECT slug, system_prompt, trigger_patterns, audit_score, skill_md_lines
         FROM agent_skills
        WHERE agent_id = $1 AND status = 'active'
        ORDER BY audit_score DESC, slug ASC
        LIMIT 50`,
      [agentId],
    );
    if (r.rowCount === 0) return empty;

    const lowerText = messageText.toLowerCase();
    const scored: Array<{ slug: string; system_prompt: string; score: number; approxTokens: number }> = [];

    for (const row of r.rows) {
      const patterns = normalizePatterns(row.trigger_patterns);
      if (patterns.length === 0) continue;

      let score = 0;
      for (const p of patterns) {
        const weight = typeof p.weight === 'number' && p.weight > 0 ? p.weight : 1;
        if (matches(p, lowerText, taskType)) score += weight;
      }

      if (score > 0) {
        scored.push({
          slug: row.slug,
          system_prompt: row.system_prompt,
          score,
          approxTokens: approxTokens(row.system_prompt),
        });
      }
    }

    if (scored.length === 0) return empty;
    // Stable sort: score DESC, then approxTokens ASC (prefer cheaper skills
    // in ties so budget accommodates more), then slug ASC for determinism.
    scored.sort(
      (a, b) => b.score - a.score || a.approxTokens - b.approxTokens || a.slug.localeCompare(b.slug),
    );

    const loaded: typeof scored = [];
    let used = 0;
    for (const s of scored) {
      const withSep = s.approxTokens + 2; // '\n\n---\n\n' separator ~ 2 tokens
      if (used + withSep > budgetTokens) continue;
      loaded.push(s);
      used += withSep;
    }

    if (loaded.length === 0) return empty;
    const systemPromptPrefix = loaded.map((s) => s.system_prompt.trim()).join('\n\n---\n\n');
    return {
      systemPromptPrefix,
      matchedSkills: loaded.map((s) => s.slug),
      tokensUsed: used,
      budgetTokens,
    };
  }

  // ── 2. pickCandidate — Task 10 ────────────────────────────────────────

  /**
   * Pick one candidate seller per the configured policy. Reads
   * agent_router_policies for the primary agent; falls back to
   * 'reputation-aware' when unset.
   *
   * Returns null when candidates list is empty. Ties broken by slug ASC.
   */
  async pickCandidate(
    primaryAgentId: string,
    candidates: Candidate[],
  ): Promise<Candidate | null> {
    if (candidates.length === 0) return null;
    const policy = await this.loadPolicy(primaryAgentId);
    return pickByPolicy(candidates, policy);
  }

  // ── 3. orchestrate — Task 10 ──────────────────────────────────────────

  /**
   * Fan-out orchestration. LLM decomposes buyer intent into typed sub-tasks;
   * each sub-task is dispatched to a picked seller; sub-responses are
   * fanned in via a second LLM call for synthesis. Writes:
   *   1 primary row + N sub_agent_hires rows, chained by parent_hash.
   *
   * v1.0 payment model: revenue split is RECORDED in `budget_split` for
   * every row (primary + subs). Actual on-chain settlement lives at
   * /api/v1/<slug> and ships alongside U5 multi-rail in v1.1. This
   * endpoint proves the wire contract + attestation chain shape.
   */
  async orchestrate(
    primaryAgentId: string,
    envelope: OapEnvelope,
    ownerAddress: string,
    opts: OrchestrateOptions = {},
  ): Promise<OrchestrationResult> {
    const maxSubAgents = Math.max(0, Math.min(10, opts.maxSubAgents ?? 3));
    const fallbackToSingleHop = opts.fallbackToSingleHop ?? true;
    const budgetSplit = opts.budgetSplit ?? DEFAULT_BUDGET_SPLIT;
    const startedAt = new Date();

    // Load primary agent for persona.system_prompt.
    const primaryRow = await this.deps.pool.query<{
      id: string;
      slug: string;
      persona: { system_prompt?: string | null } | null;
    }>(`SELECT id, slug, persona FROM agents WHERE id = $1 AND archived_at IS NULL LIMIT 1`, [primaryAgentId]);
    const primary = primaryRow.rows[0];
    if (!primary) {
      throw Object.assign(new Error('primary agent not found'), { status: 404 });
    }

    // Phase 1 — Decompose. If decomposition fails or returns 0 subs, we
    // fall back to a single-hop call (equivalent to /call) — safest path.
    let subTasks: Array<{ description: string; capability?: string }>;
    try {
      subTasks = await this.decomposeIntent(envelope, maxSubAgents);
    } catch (e) {
      this.deps.logger.warn(
        { err: (e as Error).message, agentId: primaryAgentId },
        'orchestrate:decompose:failed',
      );
      subTasks = [];
    }

    if (subTasks.length === 0 && fallbackToSingleHop) {
      return this.singleHop(primary, envelope, budgetSplit, startedAt);
    }

    // Phase 2 — Fan-out. For each sub-task, find + pick + dispatch.
    const subHiresPromises = subTasks.slice(0, maxSubAgents).map(async (task) => {
      const candidates = await this.findCandidates(task.description, primary.id);
      const picked = await this.pickCandidate(primary.id, candidates);
      if (!picked) {
        return { ok: false as const, task, error: 'no_candidate' };
      }
      try {
        const output = await this.dispatchSubHire(picked, task.description, envelope);
        return { ok: true as const, task, picked, output };
      } catch (e) {
        return { ok: false as const, task, picked, error: (e as Error).message };
      }
    });
    const subHireResults = await Promise.all(subHiresPromises);

    // Phase 3 — Fan-in synthesis. Compose final answer from sub-outputs.
    const successful = subHireResults.filter((r) => r.ok);
    let finalOutput = '';
    if (successful.length === 0) {
      // All sub-hires failed → fall back to single-hop.
      return this.singleHop(primary, envelope, budgetSplit, startedAt);
    }
    try {
      finalOutput = await this.synthesizeFinal(envelope, successful.map((r) => ({
        task: r.task.description,
        output: r.output,
      })));
    } catch (e) {
      this.deps.logger.warn({ err: (e as Error).message }, 'orchestrate:synthesize:failed');
      // Degrade: concatenate sub-outputs verbatim so caller still gets value.
      finalOutput = successful.map((r) => `# ${r.task.description}\n${r.output}`).join('\n\n');
    }

    // Phase 4 — Attestation chain + ledger writes.
    const primaryAttestation = hashAttestation({
      agentId: primary.id,
      traceId: envelope.trace_id,
      output: finalOutput,
      parentHash: envelope.parent_hash ?? null,
    });

    const subHireLedger: OrchestrationResult['sub_hires'] = [];
    for (const r of successful) {
      const subAttestation = hashAttestation({
        agentId: r.picked.agent_id,
        traceId: envelope.trace_id,
        output: r.output,
        parentHash: primaryAttestation,
      });
      subHireLedger.push({
        agent_id: r.picked.agent_id,
        attestation_hash: subAttestation,
        cost_usdc: r.picked.cost_usdc ?? '0',
      });
    }

    // Ledger writes: primary row first, then sub rows referencing it.
    await this.writeLedger({
      primaryAgentId: primary.id,
      traceId: envelope.trace_id,
      parentHash: envelope.parent_hash ?? null,
      primaryAttestation,
      finalOutput,
      subHires: successful.map((r, i) => ({
        subAgentId: r.picked.agent_id,
        attestationHash: subHireLedger[i].attestation_hash,
        parentHash: primaryAttestation,
        output: r.output,
        cost_usdc: r.picked.cost_usdc ?? '0',
      })),
      budgetSplit,
      startedAt,
    });

    return {
      trace_id: envelope.trace_id,
      parent_hash: envelope.parent_hash,
      output: finalOutput,
      attestation_hash: primaryAttestation,
      sub_hires: subHireLedger,
      tokens: {
        input: approxTokens(envelope.intent.description),
        output: approxTokens(finalOutput),
      },
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private async loadPolicy(agentId: string): Promise<RouterPolicy> {
    const r = await this.deps.pool.query<{ policy: RouterPolicy }>(
      `SELECT policy FROM agent_router_policies WHERE agent_id = $1 LIMIT 1`,
      [agentId],
    );
    return (r.rows[0]?.policy ?? 'reputation-aware') as RouterPolicy;
  }

  private async decomposeIntent(
    envelope: OapEnvelope,
    maxSubAgents: number,
  ): Promise<Array<{ description: string; capability?: string }>> {
    const system =
      `You are an OpenX orchestrator. Given a buyer intent, decompose it into ` +
      `${maxSubAgents} or fewer independent sub-tasks. Each sub-task should be ` +
      `hireable by a single specialized agent. OUTPUT STRICT JSON, no markdown:\n` +
      `{"sub_tasks": [{"description": "...", "capability": "..."}]}\n` +
      `If the intent is already atomic (single-hop), return {"sub_tasks": []}.`;
    const user = JSON.stringify({
      task_type: envelope.intent.task_type,
      description: envelope.intent.description,
      from_lang: envelope.intent.from_lang,
      to_lang: envelope.intent.to_lang,
    });
    const raw = await this.llm(system, [{ role: 'user', content: user }]);
    // Best-effort JSON extraction — LLM may wrap in code fences or narrate.
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]) as { sub_tasks?: Array<{ description?: string; capability?: string }> };
    return (parsed.sub_tasks ?? [])
      .filter((t) => typeof t.description === 'string' && t.description.trim())
      .map((t) => ({ description: (t.description as string).trim(), capability: t.capability }));
  }

  /**
   * Find candidate sellers whose stored description or tags match the sub-task
   * (simple ILIKE for v1.0). Excludes the primary agent from candidates so
   * the orchestrator can't hire itself (guards recursive spawning).
   */
  private async findCandidates(subTaskDescription: string, primaryAgentId: string): Promise<Candidate[]> {
    // Extract 1-3 keyword-ish terms (letters/digits, 4+ chars, up to 3).
    const terms = Array.from(new Set(
      (subTaskDescription.match(/[a-z0-9]{4,}/gi) ?? [])
        .map((w) => w.toLowerCase())
        .slice(0, 3),
    ));
    if (terms.length === 0) return [];
    const patterns = terms.map((t) => `%${t}%`);
    const r = await this.deps.pool.query<{
      id: string;
      slug: string;
      pricing: { x402?: string | null } | null;
    }>(
      `SELECT id, slug, pricing
         FROM agents
        WHERE published = true
          AND archived_at IS NULL
          AND id <> $1
          AND (
            (persona->>'description') ILIKE ANY ($2::text[])
            OR display_name ILIKE ANY ($2::text[])
            OR short_description ILIKE ANY ($2::text[])
          )
        LIMIT 10`,
      [primaryAgentId, patterns],
    );
    return r.rows.map((row) => ({
      agent_id: row.id,
      slug: row.slug,
      cost_usdc: row.pricing?.x402 ?? '0',
    }));
  }

  private async dispatchSubHire(
    candidate: Candidate,
    subTaskDescription: string,
    parentEnvelope: OapEnvelope,
  ): Promise<string> {
    // v1.0: dispatch inline via llmChat with the candidate agent's persona.
    // v1.1 will route through /api/v1/<slug> (paid hop) once U5 multi-rail
    // lands so real USDC actually moves.
    const r = await this.deps.pool.query<{ persona: { system_prompt?: string | null } | null }>(
      `SELECT persona FROM agents WHERE id = $1 AND archived_at IS NULL LIMIT 1`,
      [candidate.agent_id],
    );
    const subSystem = r.rows[0]?.persona?.system_prompt ?? 'You are an OpenX sub-agent. Respond concisely.';
    const subUser = `Task from primary orchestrator (trace ${parentEnvelope.trace_id}):\n${subTaskDescription}`;
    return await this.llm(subSystem, [{ role: 'user', content: subUser }]);
  }

  private async synthesizeFinal(
    envelope: OapEnvelope,
    parts: Array<{ task: string; output: string }>,
  ): Promise<string> {
    const system =
      `You are the primary OpenX orchestrator. Synthesize a single coherent ` +
      `final answer for the buyer from the sub-agent outputs below. Preserve ` +
      `citations. No preamble; return the answer only.`;
    const user =
      `Buyer intent: ${envelope.intent.description}\n\n` +
      parts.map((p, i) => `Sub-task ${i + 1}: ${p.task}\nOutput: ${p.output}`).join('\n\n');
    return await this.llm(system, [{ role: 'user', content: user }]);
  }

  private async singleHop(
    primary: { id: string; slug: string; persona: { system_prompt?: string | null } | null },
    envelope: OapEnvelope,
    budgetSplit: OrchestrateOptions['budgetSplit'],
    startedAt: Date,
  ): Promise<OrchestrationResult> {
    const system = primary.persona?.system_prompt?.trim() || 'You are an OpenX agent.';
    const user = envelope.intent.description;
    const output = await this.llm(system, [{ role: 'user', content: user }]);
    const attestation = hashAttestation({
      agentId: primary.id,
      traceId: envelope.trace_id,
      output,
      parentHash: envelope.parent_hash ?? null,
    });
    await this.writeLedger({
      primaryAgentId: primary.id,
      traceId: envelope.trace_id,
      parentHash: envelope.parent_hash ?? null,
      primaryAttestation: attestation,
      finalOutput: output,
      subHires: [],
      budgetSplit: budgetSplit ?? DEFAULT_BUDGET_SPLIT,
      startedAt,
    });
    return {
      trace_id: envelope.trace_id,
      parent_hash: envelope.parent_hash,
      output,
      attestation_hash: attestation,
      sub_hires: [],
      tokens: { input: approxTokens(user), output: approxTokens(output) },
    };
  }

  private async writeLedger(row: {
    primaryAgentId: string;
    traceId: string;
    parentHash: string | null;
    primaryAttestation: string;
    finalOutput: string;
    subHires: Array<{
      subAgentId: string;
      attestationHash: string;
      parentHash: string;
      output: string;
      cost_usdc: string;
    }>;
    budgetSplit: NonNullable<OrchestrateOptions['budgetSplit']>;
    startedAt: Date;
  }): Promise<void> {
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - row.startedAt.getTime();
    try {
      await this.deps.pool.query(
        `INSERT INTO sub_agent_hires
           (primary_agent_id, sub_agent_id, trace_id, parent_hash, attestation_hash,
            role, budget_split, cost_usdc, output_summary, status, duration_ms,
            started_at, finished_at)
         VALUES ($1, NULL, $2, $3, $4, 'primary', $5::jsonb, 0, $6, 'succeeded', $7, $8, $9)`,
        [
          row.primaryAgentId,
          row.traceId,
          row.parentHash,
          row.primaryAttestation,
          JSON.stringify(row.budgetSplit),
          row.finalOutput.slice(0, 500),
          durationMs,
          row.startedAt,
          finishedAt,
        ],
      );
      for (const sub of row.subHires) {
        await this.deps.pool.query(
          `INSERT INTO sub_agent_hires
             (primary_agent_id, sub_agent_id, trace_id, parent_hash, attestation_hash,
              role, budget_split, cost_usdc, output_summary, status, duration_ms,
              started_at, finished_at)
           VALUES ($1, $2, $3, $4, $5, 'sub_agent', $6::jsonb, $7, $8, 'succeeded', $9, $10, $11)`,
          [
            row.primaryAgentId,
            sub.subAgentId,
            row.traceId,
            sub.parentHash,
            sub.attestationHash,
            JSON.stringify(row.budgetSplit),
            sub.cost_usdc,
            sub.output.slice(0, 500),
            durationMs,
            row.startedAt,
            finishedAt,
          ],
        );
      }
    } catch (e) {
      this.deps.logger.warn(
        { err: (e as Error).message, traceId: row.traceId },
        'orchestrate:ledger-write:failed',
      );
    }
  }
}

// ─── Module helpers ─────────────────────────────────────────────────────

/**
 * Pure policy application — deterministic, no DB, no I/O. Exported so
 * smoke tests can exercise all 5 policies at module level.
 */
export function pickByPolicy(candidates: Candidate[], policy: RouterPolicy): Candidate | null {
  if (candidates.length === 0) return null;
  switch (policy) {
    case 'round-robin':
      // Deterministic first-by-slug; rotation via params.rotate_offset in v1.1.
      return [...candidates].sort((a, b) => a.slug.localeCompare(b.slug))[0];
    case 'lru':
      return [...candidates].sort((a, b) => {
        const ta = a.last_hire_at ? Date.parse(a.last_hire_at) : 0;
        const tb = b.last_hire_at ? Date.parse(b.last_hire_at) : 0;
        return ta - tb || a.slug.localeCompare(b.slug);
      })[0];
    case 'usage-aware':
      return [...candidates].sort(
        (a, b) => (a.active_hires ?? 0) - (b.active_hires ?? 0) || a.slug.localeCompare(b.slug),
      )[0];
    case 'cost-aware':
      return [...candidates].sort(
        (a, b) => parseFloat(a.cost_usdc ?? '0') - parseFloat(b.cost_usdc ?? '0') || a.slug.localeCompare(b.slug),
      )[0];
    case 'reputation-aware':
    default:
      return [...candidates].sort(
        (a, b) => (b.reputation_score ?? 0) - (a.reputation_score ?? 0) || a.slug.localeCompare(b.slug),
      )[0];
  }
}

/** Convert legacy string-array triggers to typed patterns at read time. */
function normalizePatterns(raw: unknown): TriggerPattern[] {
  if (!Array.isArray(raw)) return [];
  const out: TriggerPattern[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      out.push({ type: 'keyword', match: [item], weight: 1 });
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const type = obj.type;
      const weight = typeof obj.weight === 'number' ? obj.weight : 1;
      if (type === 'keyword' && Array.isArray(obj.match)) {
        out.push({ type, match: obj.match as string[], weight });
      } else if (type === 'task_type' && Array.isArray(obj.match)) {
        out.push({ type, match: obj.match as string[], weight });
      } else if (type === 'regex' && typeof obj.pattern === 'string') {
        out.push({ type, pattern: obj.pattern, flags: typeof obj.flags === 'string' ? obj.flags : undefined, weight });
      }
    }
  }
  return out;
}

function matches(p: TriggerPattern, lowerText: string, taskType?: string): boolean {
  switch (p.type) {
    case 'keyword':
      return p.match.some((k) => k && lowerText.includes(k.toLowerCase()));
    case 'task_type':
      return taskType !== undefined && p.match.includes(taskType);
    case 'regex':
      try {
        return new RegExp(p.pattern, p.flags ?? '').test(lowerText);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function approxTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function hashAttestation(input: {
  agentId: string;
  traceId: string;
  output: string;
  parentHash: string | null;
}): string {
  const canonical = `${input.agentId}|${input.traceId}|${input.output}|${input.parentHash ?? ''}`;
  return 'sha256:' + createHash('sha256').update(canonical).digest('hex');
}

// ─── Singleton — one instance for the whole api process ─────────────────
export const agentOrchestrationService = new AgentOrchestrationService({ pool, logger });
