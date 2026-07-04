/**
 * autoDreamService — PRD-U4 memory consolidator (self-contained per 4=a).
 *
 * Four-phase weekly cycle for every agent with ≥10 hires since last dream:
 *
 *   Phase 1 — Orientation      (≤ $0.10) : read persona + skills + hire sample
 *   Phase 2 — Gather Signal    (≤ $0.20) : LLM identifies gaps + patterns
 *   Phase 3 — Consolidation    (≤ $1.20) : LLM proposes typed diffs (JSON)
 *   Phase 4 — Prune & Index    (≤ $0.30) : dedupe + persist as 'draft' skills
 *
 *   Total hard cap: $1.80 (safely under the PRD-U4 $2 nominal).
 *
 * On any phase cap breach the run is marked 'failed' and no diffs land.
 * Fugu Ultra is primary + Bedrock Claude the fallback via the existing
 * `llmChat` provider cascade in `chat.ts` (no cross-repo deps per 4=a).
 *
 * Seller-approve gate: proposed diffs write with status='pending' and
 * their target skill (if new) writes as status='draft'. Approval flips
 * the diff to 'approved' + the skill to 'active' inside one TX.
 *
 * Feature flag: caller (worker cron / approve endpoint) checks
 * FEATURE_AUTO_DREAM; this module is unconditionally importable.
 *
 * SOLID:
 *   • SRP — one job: propose safe skill improvements the seller can approve.
 *   • OCP — new diff kinds slot in as new `operation` enum values in
 *          migration 043 + one case in `applyApprovedDiff`.
 *   • DIP — { pool, logger, llmChat } injected via constructor for tests.
 */

import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Logger } from 'pino';
import { pool } from '../db';
import { logger } from '../lib';
import { llmChat } from './chat';

// ─── Types ──────────────────────────────────────────────────────────────

export interface DreamRunSummary {
  run_id: string;
  status: DreamRunStatus;
  phases_completed: DreamPhase[];
  cost_usdc: number;
  diff_count: number;
  hires_analyzed: number;
  error?: string;
}

export interface DreamDiff {
  id: string;
  run_id: string;
  target_kind: 'skill' | 'persona';
  target_ref: string;
  operation: 'add' | 'edit' | 'delete' | 'merge';
  old_text: string | null;
  new_text: string;
  rationale: string;
  predicted_eval_delta: number;
  status: 'pending' | 'approved' | 'rejected' | 'superseded';
}

export interface ApprovalResult {
  applied_diff_ids: string[];
  rejected_diff_ids: string[];
  persona_updated: boolean;
}

export type DreamPhase = 'orientation' | 'gather_signal' | 'consolidation' | 'prune_and_index';
type DreamRunStatus =
  | 'started'
  | 'phase_1'
  | 'phase_2'
  | 'phase_3'
  | 'phase_4'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'failed';

interface Deps {
  pool: Pool;
  logger: Logger;
  /** Injected for tests — defaults to real llmChat. */
  llmChat?: typeof llmChat;
}

// ─── Cost model — approx per-phase caps applied progressively ──────────

const PHASE_CAPS_USDC = {
  orientation: 0.10,
  gather_signal: 0.20,
  consolidation: 1.20,
  prune_and_index: 0.30,
} as const;
const TOTAL_CAP_USDC = 1.80;

// Bedrock Claude Opus 4.6 pricing per 1M tokens (as of Jul 2026).
const PRICE_INPUT_USDC_PER_TOKEN = 15 / 1_000_000;
const PRICE_OUTPUT_USDC_PER_TOKEN = 75 / 1_000_000;

// Hire sample cap per run — keeps prompt small + cheap.
const HIRE_SAMPLE_SIZE = 20;
const MIN_HIRES_TO_QUALIFY = 10;

// ─── Service ────────────────────────────────────────────────────────────

export class AutoDreamService {
  private readonly llm: typeof llmChat;

  constructor(private readonly deps: Deps) {
    this.llm = deps.llmChat ?? llmChat;
  }

  // ── 1. eligibility query ────────────────────────────────────────────────

  /**
   * Agents eligible for a dream cycle now. Cheap — a single indexed query.
   * Cron worker calls this once per week + iterates the result.
   */
  async getEligibleAgents(): Promise<Array<{ agent_id: string; hires_since_last: number }>> {
    const r = await this.deps.pool.query<{ agent_id: string; hires_since_last: string }>(
      `WITH last_run AS (
         SELECT agent_id, MAX(finished_at) AS finished_at
           FROM auto_dream_runs
          WHERE status IN ('approved', 'pending_approval', 'rejected')
          GROUP BY agent_id
       )
       SELECT a.id AS agent_id,
              COUNT(pc.id)::text AS hires_since_last
         FROM agents a
         LEFT JOIN last_run lr ON lr.agent_id = a.id
         LEFT JOIN paid_calls pc
           ON pc.agent_id = a.id
          AND pc.created_at > COALESCE(lr.finished_at, '1970-01-01'::timestamptz)
        WHERE a.archived_at IS NULL AND a.published = true
        GROUP BY a.id, lr.finished_at
       HAVING COUNT(pc.id) >= $1`,
      [MIN_HIRES_TO_QUALIFY],
    );
    return r.rows.map((row) => ({
      agent_id: row.agent_id,
      hires_since_last: Number(row.hires_since_last),
    }));
  }

  // ── 2. full 4-phase run ─────────────────────────────────────────────────

  /**
   * Full 4-phase cycle for one agent. Failure at any phase writes 'failed'
   * status + short-circuits. Cost is tracked cumulatively; caps enforced
   * per-phase + total.
   */
  async run(agentId: string): Promise<DreamRunSummary> {
    const runId = randomUUID();

    // Bootstrap: insert 'started' row so we can UPDATE as we progress.
    await this.deps.pool.query(
      `INSERT INTO auto_dream_runs (id, agent_id, status, started_at)
         VALUES ($1, $2, 'started', now())`,
      [runId, agentId],
    );

    const state = {
      cost_usdc: 0,
      phases_completed: [] as DreamPhase[],
      hires_analyzed: 0,
    };

    try {
      // ── Phase 1 — Orientation ─────────────────────────────────────────
      await this.markPhase(runId, 'phase_1');
      const orient = await this.phase1_orientation(agentId, state);
      state.hires_analyzed = orient.hiresAnalyzed;
      state.phases_completed.push('orientation');
      this.assertPhaseCap('orientation', state.cost_usdc);

      // ── Phase 2 — Gather Signal ───────────────────────────────────────
      await this.markPhase(runId, 'phase_2');
      const signals = await this.phase2_gatherSignal(orient, state);
      state.phases_completed.push('gather_signal');
      this.assertPhaseCap('gather_signal', state.cost_usdc);

      // ── Phase 3 — Consolidation (LLM diff proposal) ───────────────────
      await this.markPhase(runId, 'phase_3');
      const proposedDiffs = await this.phase3_consolidate(orient, signals, state);
      state.phases_completed.push('consolidation');
      this.assertPhaseCap('consolidation', state.cost_usdc);

      // ── Phase 4 — Prune & Index ───────────────────────────────────────
      await this.markPhase(runId, 'phase_4');
      const persistedDiffs = await this.phase4_pruneAndIndex(agentId, runId, proposedDiffs);
      state.phases_completed.push('prune_and_index');
      this.assertPhaseCap('prune_and_index', state.cost_usdc);
      this.assertTotalCap(state.cost_usdc);

      // Success → pending_approval for seller review.
      const status: DreamRunStatus = persistedDiffs.length > 0 ? 'pending_approval' : 'approved';
      await this.finalizeRun(runId, status, state, null);

      return {
        run_id: runId,
        status,
        phases_completed: state.phases_completed,
        cost_usdc: state.cost_usdc,
        diff_count: persistedDiffs.length,
        hires_analyzed: state.hires_analyzed,
      };
    } catch (err) {
      const msg = (err as Error).message ?? 'unknown';
      await this.finalizeRun(runId, 'failed', state, msg.slice(0, 500));
      this.deps.logger.warn({ agentId, runId, err: msg }, 'auto-dream:failed');
      return {
        run_id: runId,
        status: 'failed',
        phases_completed: state.phases_completed,
        cost_usdc: state.cost_usdc,
        diff_count: 0,
        hires_analyzed: state.hires_analyzed,
        error: msg,
      };
    }
  }

  // ── 3. approveDiffs — seller-approve gate (EIP-712 verified upstream) ───

  /**
   * Apply the selected diffs inside one TX:
   *   • flip diff.status → 'approved' | 'rejected'
   *   • for approved 'skill' diffs, flip agent_skills.status='draft' → 'active'
   *   • for approved 'persona' diffs, update agents.persona.system_prompt
   *   • insert one row into auto_dream_approvals with the signature
   *
   * The signature is verified by the ROUTE HANDLER (ethers.verifyTypedData);
   * this service accepts only the already-verified owner address.
   */
  async approveDiffs(
    runId: string,
    agentId: string,
    ownerAddress: string,
    action: 'approve' | 'reject',
    selectedDiffIds: string[],
    signature: string,
  ): Promise<ApprovalResult> {
    const client = await this.deps.pool.connect();
    const applied: string[] = [];
    const rejected: string[] = [];
    let personaUpdated = false;

    try {
      await client.query('BEGIN');

      // Ownership check inside the TX.
      const own = await client.query<{ owner_address: string }>(
        `SELECT owner_address FROM agents WHERE id = $1 LIMIT 1`,
        [agentId],
      );
      if (own.rowCount === 0) throw Object.assign(new Error('agent not found'), { status: 404 });
      if (own.rows[0].owner_address.toLowerCase() !== ownerAddress.toLowerCase()) {
        throw Object.assign(new Error('not owner'), { status: 403 });
      }

      // Load pending diffs for this run.
      const diffsQ = await client.query<{
        id: string;
        target_kind: string;
        target_ref: string;
        operation: string;
        new_text: string;
      }>(
        `SELECT id, target_kind, target_ref, operation, new_text
           FROM auto_dream_diffs
          WHERE run_id = $1 AND agent_id = $2 AND status = 'pending'`,
        [runId, agentId],
      );
      const diffs = diffsQ.rows;
      if (diffs.length === 0) {
        throw Object.assign(new Error('no pending diffs for this run'), { status: 404 });
      }

      const selectedSet = new Set(selectedDiffIds);
      for (const d of diffs) {
        const isSelected = selectedSet.has(d.id);
        const nextStatus =
          action === 'reject'
            ? 'rejected'
            : isSelected
            ? 'approved'
            : 'rejected';

        await client.query(
          `UPDATE auto_dream_diffs SET status = $1 WHERE id = $2`,
          [nextStatus, d.id],
        );

        if (nextStatus === 'approved') {
          applied.push(d.id);
          if (d.target_kind === 'skill') {
            await this.applyApprovedSkillDiff(client, agentId, d);
          } else if (d.target_kind === 'persona') {
            await this.applyApprovedPersonaDiff(client, agentId, d);
            personaUpdated = true;
          }
        } else {
          rejected.push(d.id);
        }
      }

      // Audit row.
      await client.query(
        `INSERT INTO auto_dream_approvals
           (run_id, agent_id, owner_address, action, selected_diff_ids, signature)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [runId, agentId, ownerAddress.toLowerCase(), action, JSON.stringify(selectedDiffIds), signature],
      );

      // Run-level status update.
      await client.query(
        `UPDATE auto_dream_runs SET status = $1 WHERE id = $2`,
        [action === 'reject' ? 'rejected' : 'approved', runId],
      );

      await client.query('COMMIT');
      return { applied_diff_ids: applied, rejected_diff_ids: rejected, persona_updated: personaUpdated };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  // ── Private phase implementations ───────────────────────────────────────

  private async phase1_orientation(
    agentId: string,
    state: { cost_usdc: number },
  ): Promise<Phase1Result> {
    // Load persona + active skills + a sample of recent hires. Cheap SQL.
    const [agentR, skillsR, hiresR] = await Promise.all([
      this.deps.pool.query<{ persona: { system_prompt?: string | null } | null; slug: string }>(
        `SELECT slug, persona FROM agents WHERE id = $1 LIMIT 1`,
        [agentId],
      ),
      this.deps.pool.query<{
        slug: string;
        system_prompt: string;
        trigger_patterns: unknown;
        audit_score: number;
      }>(
        `SELECT slug, system_prompt, trigger_patterns, audit_score
           FROM agent_skills WHERE agent_id = $1 AND status = 'active'
          ORDER BY audit_score DESC LIMIT 20`,
        [agentId],
      ),
      this.deps.pool.query<{ question: string; response_snippet: string; created_at: string }>(
        `SELECT
            COALESCE(pc.request_body->>'question','') AS question,
            COALESCE(LEFT(pc.response_snippet, 200),'') AS response_snippet,
            pc.created_at
           FROM paid_calls pc
          WHERE pc.agent_id = $1
          ORDER BY pc.created_at DESC LIMIT $2`,
        [agentId, HIRE_SAMPLE_SIZE],
      ),
    ]);

    if (agentR.rowCount === 0) throw new Error('agent not found');

    // Tiny LLM call: 1-sentence summary of what the agent currently does.
    const persona = agentR.rows[0].persona?.system_prompt?.trim() || '(no persona)';
    const skillSummary = skillsR.rows.map((s) => `- ${s.slug}: ${s.system_prompt.slice(0, 100)}`).join('\n');
    const orientPrompt =
      `In one sentence, summarize what this agent does and one weakness ` +
      `visible in the skill list.\n\nPersona:\n${persona.slice(0, 500)}\n\n` +
      `Skills:\n${skillSummary || '(none)'}`;
    const summary = await this.callLlmWithCost(
      'You are an OpenX auto-dream orientation analyzer. Respond in one sentence.',
      orientPrompt,
      state,
      PHASE_CAPS_USDC.orientation,
    );

    return {
      agentId,
      agentSlug: agentR.rows[0].slug,
      persona,
      skills: skillsR.rows.map((s) => ({ slug: s.slug, systemPrompt: s.system_prompt })),
      hires: hiresR.rows.map((h) => ({ question: h.question, response: h.response_snippet })),
      hiresAnalyzed: hiresR.rows.length,
      summary,
    };
  }

  private async phase2_gatherSignal(
    orient: Phase1Result,
    state: { cost_usdc: number },
  ): Promise<Phase2Result> {
    // LLM call: identify recurring patterns in the hire sample. Bounded prompt.
    const hireSample = orient.hires
      .slice(0, HIRE_SAMPLE_SIZE)
      .map((h, i) => `${i + 1}. Q: ${h.question.slice(0, 120)}\n   A: ${h.response.slice(0, 120)}`)
      .join('\n');
    const gatherPrompt =
      `Given this agent summary and a sample of recent hires, identify 1-3 ` +
      `concrete gaps (missing capability, unclear response, poor register). ` +
      `Return STRICT JSON:\n` +
      `{"gaps": [{"description": "...", "evidence": "hire #N"}]}\n\n` +
      `Summary: ${orient.summary}\n\nHires:\n${hireSample || '(none)'}`;
    const raw = await this.callLlmWithCost(
      'You are an OpenX auto-dream signal analyzer. Return STRICT JSON only.',
      gatherPrompt,
      state,
      PHASE_CAPS_USDC.gather_signal,
    );

    const gaps = parseJsonArray<{ description?: string; evidence?: string }>(raw, 'gaps')
      .filter((g): g is { description: string; evidence?: string } =>
        typeof g.description === 'string' && g.description.trim().length > 0,
      )
      .slice(0, 3);
    return { gaps };
  }

  private async phase3_consolidate(
    orient: Phase1Result,
    signals: Phase2Result,
    state: { cost_usdc: number },
  ): Promise<ProposedDiff[]> {
    if (signals.gaps.length === 0) return [];
    const gapText = signals.gaps
      .map((g, i) => `${i + 1}. ${g.description} (${g.evidence ?? 'unspec'})`)
      .join('\n');
    const consolidatePrompt =
      `Propose concrete SKILL diffs to close these gaps. Each diff MUST have ` +
      `an operation (add/edit/delete/merge), a target skill slug (or 'new' for ` +
      `add), a full replacement system_prompt (or empty for delete), a short ` +
      `rationale, and a predicted_eval_delta between 0 and 1. Return STRICT JSON:\n` +
      `{"diffs": [{"operation":"add|edit|delete|merge","target_ref":"slug",` +
      `"new_text":"...","rationale":"...","predicted_eval_delta":0.0}]}\n\n` +
      `Gaps:\n${gapText}\n\n` +
      `Current skills:\n${orient.skills.map((s) => `- ${s.slug}`).join('\n') || '(none)'}`;
    const raw = await this.callLlmWithCost(
      'You are an OpenX auto-dream skill-diff proposer. Return STRICT JSON only, max 3 diffs.',
      consolidatePrompt,
      state,
      PHASE_CAPS_USDC.consolidation,
    );

    const parsed = parseJsonArray<{
      operation?: string;
      target_ref?: string;
      new_text?: string;
      rationale?: string;
      predicted_eval_delta?: number;
    }>(raw, 'diffs');
    return parsed
      .filter(
        (d) =>
          typeof d.operation === 'string' &&
          ['add', 'edit', 'delete', 'merge'].includes(d.operation) &&
          typeof d.target_ref === 'string' &&
          typeof d.new_text === 'string' &&
          typeof d.rationale === 'string',
      )
      .slice(0, 3)
      .map((d) => ({
        operation: d.operation as ProposedDiff['operation'],
        target_ref: d.target_ref!,
        new_text: d.new_text!,
        rationale: d.rationale!,
        predicted_eval_delta: clamp01(Number(d.predicted_eval_delta ?? 0)),
      }));
  }

  private async phase4_pruneAndIndex(
    agentId: string,
    runId: string,
    proposed: ProposedDiff[],
  ): Promise<Array<{ id: string; target_ref: string }>> {
    // Dedupe: same target_ref + operation → keep the highest predicted_eval_delta.
    const bucket = new Map<string, ProposedDiff>();
    for (const p of proposed) {
      const key = `${p.operation}|${p.target_ref}`;
      const cur = bucket.get(key);
      if (!cur || p.predicted_eval_delta > cur.predicted_eval_delta) bucket.set(key, p);
    }

    const client = await this.deps.pool.connect();
    const persisted: Array<{ id: string; target_ref: string }> = [];
    try {
      await client.query('BEGIN');
      for (const p of bucket.values()) {
        // Fetch old_text for edit/delete/merge on existing skills.
        let oldText: string | null = null;
        if (p.operation !== 'add') {
          const cur = await client.query<{ system_prompt: string }>(
            `SELECT system_prompt FROM agent_skills WHERE agent_id = $1 AND slug = $2 LIMIT 1`,
            [agentId, p.target_ref],
          );
          oldText = cur.rows[0]?.system_prompt ?? null;
          if (oldText === null) continue; // skip diffs targeting missing skills
        }

        const inserted = await client.query<{ id: string }>(
          `INSERT INTO auto_dream_diffs
             (run_id, agent_id, target_kind, target_ref, operation,
              old_text, new_text, rationale, predicted_eval_delta, status)
           VALUES ($1, $2, 'skill', $3, $4, $5, $6, $7, $8, 'pending')
           RETURNING id`,
          [runId, agentId, p.target_ref, p.operation, oldText, p.new_text, p.rationale, p.predicted_eval_delta],
        );
        const diffId = inserted.rows[0].id;
        persisted.push({ id: diffId, target_ref: p.target_ref });

        // For 'add', pre-create the target skill row as 'draft' so
        // approveDiffs just flips status to 'active'.
        if (p.operation === 'add') {
          const draftSlug = ensureUniqueSlug(agentId, p.target_ref);
          await client.query(
            `INSERT INTO agent_skills
               (agent_id, slug, name, description, system_prompt, skill_md_content,
                skill_md_lines, trigger_type, leading_word, trigger_patterns,
                audit_score, source_type, status)
             VALUES ($1, $2, $3, $3, $4, $4, $5, 'user', $2, '[]'::jsonb, 0.5, 'llm_auto', 'draft')
             ON CONFLICT (agent_id, slug) DO UPDATE
               SET system_prompt = EXCLUDED.system_prompt, updated_at = now()`,
            [
              agentId,
              draftSlug,
              `Auto-dream proposal: ${p.target_ref}`,
              p.new_text,
              Math.max(1, p.new_text.split('\n').length),
            ],
          );
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    return persisted;
  }

  // ── Approval sub-steps ─────────────────────────────────────────────────

  private async applyApprovedSkillDiff(
    client: PoolClient,
    agentId: string,
    diff: { target_ref: string; operation: string; new_text: string },
  ): Promise<void> {
    switch (diff.operation) {
      case 'add':
        // The Phase-4 draft row exists — flip to active.
        await client.query(
          `UPDATE agent_skills SET status = 'active', updated_at = now()
            WHERE agent_id = $1 AND slug = $2`,
          [agentId, diff.target_ref],
        );
        return;
      case 'edit':
      case 'merge':
        await client.query(
          `UPDATE agent_skills
              SET system_prompt = $3,
                  skill_md_content = $3,
                  skill_md_lines = $4,
                  source_type = 'llm_auto',
                  updated_at = now()
            WHERE agent_id = $1 AND slug = $2`,
          [agentId, diff.target_ref, diff.new_text, Math.max(1, diff.new_text.split('\n').length)],
        );
        return;
      case 'delete':
        await client.query(
          `UPDATE agent_skills SET status = 'archived', updated_at = now()
            WHERE agent_id = $1 AND slug = $2`,
          [agentId, diff.target_ref],
        );
        return;
    }
  }

  private async applyApprovedPersonaDiff(
    client: PoolClient,
    agentId: string,
    diff: { new_text: string },
  ): Promise<void> {
    // Rewrite agents.persona.system_prompt with the new text. Preserve
    // other persona fields via jsonb_set on the JSON column.
    await client.query(
      `UPDATE agents
          SET persona = jsonb_set(
            COALESCE(persona, '{}'::jsonb),
            '{system_prompt}',
            to_jsonb($2::text)
          )
        WHERE id = $1`,
      [agentId, diff.new_text],
    );
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  /** Wrap llmChat with cost tracking + per-phase cap enforcement. */
  private async callLlmWithCost(
    system: string,
    user: string,
    state: { cost_usdc: number },
    phaseCap: number,
  ): Promise<string> {
    const beforeSpend = state.cost_usdc;
    const output = await this.llm(system, [{ role: 'user', content: user }]);
    const inTokens = Math.ceil((system.length + user.length) / 4);
    const outTokens = Math.ceil(output.length / 4);
    const cost = inTokens * PRICE_INPUT_USDC_PER_TOKEN + outTokens * PRICE_OUTPUT_USDC_PER_TOKEN;
    state.cost_usdc += cost;
    if (state.cost_usdc - beforeSpend > phaseCap) {
      throw new Error(`phase cap $${phaseCap.toFixed(2)} exceeded (spent $${cost.toFixed(4)} this call)`);
    }
    return output;
  }

  private assertPhaseCap(phase: DreamPhase, cumulative: number): void {
    if (cumulative > TOTAL_CAP_USDC) {
      throw new Error(`total cap $${TOTAL_CAP_USDC.toFixed(2)} exceeded after ${phase} ($${cumulative.toFixed(4)})`);
    }
  }

  private assertTotalCap(cumulative: number): void {
    if (cumulative > TOTAL_CAP_USDC) {
      throw new Error(`total cap $${TOTAL_CAP_USDC.toFixed(2)} exceeded ($${cumulative.toFixed(4)})`);
    }
  }

  private async markPhase(runId: string, status: DreamRunStatus): Promise<void> {
    await this.deps.pool.query(
      `UPDATE auto_dream_runs SET status = $1 WHERE id = $2`,
      [status, runId],
    );
  }

  private async finalizeRun(
    runId: string,
    status: DreamRunStatus,
    state: { cost_usdc: number; phases_completed: DreamPhase[]; hires_analyzed: number },
    error: string | null,
  ): Promise<void> {
    await this.deps.pool.query(
      `UPDATE auto_dream_runs
          SET status = $1,
              phases_completed = $2::jsonb,
              cost_usdc = $3,
              hires_analyzed = $4,
              error = $5,
              finished_at = now()
        WHERE id = $6`,
      [status, JSON.stringify(state.phases_completed), state.cost_usdc, state.hires_analyzed, error, runId],
    );
  }
}

// ─── Phase result types ─────────────────────────────────────────────────

interface Phase1Result {
  agentId: string;
  agentSlug: string;
  persona: string;
  skills: Array<{ slug: string; systemPrompt: string }>;
  hires: Array<{ question: string; response: string }>;
  hiresAnalyzed: number;
  summary: string;
}

interface Phase2Result {
  gaps: Array<{ description: string; evidence?: string }>;
}

interface ProposedDiff {
  operation: 'add' | 'edit' | 'delete' | 'merge';
  target_ref: string;
  new_text: string;
  rationale: string;
  predicted_eval_delta: number;
}

// ─── Module helpers ─────────────────────────────────────────────────────

function parseJsonArray<T>(raw: string, key: string): T[] {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    return Array.isArray(obj[key]) ? (obj[key] as T[]) : [];
  } catch {
    return [];
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function ensureUniqueSlug(_agentId: string, proposedSlug: string): string {
  // v1.0: use the LLM-proposed slug as-is when it's a fresh 'add'. If it
  // collides with an existing slug on the same agent, the ON CONFLICT
  // UPDATE branch in phase4_pruneAndIndex handles it (updates the existing
  // draft in place). v1.1 will handle name-clash disambiguation properly.
  return proposedSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 30) || `auto-${Date.now().toString(36)}`;
}

// ─── Singleton — one instance for the whole api process ─────────────────
export const autoDreamService = new AutoDreamService({ pool, logger });
