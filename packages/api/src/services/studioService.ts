/**
 * studioService — PRD-V seller portal read-side aggregations.
 *
 * Five methods, one class. Every method:
 *   • takes ownerAddress and 403s if the target agent doesn't belong to it
 *   • uses on-demand JOINs + LIMIT (no materialized view, per 2=c)
 *   • returns typed row shapes matching the v3-studio.ts contracts
 *
 * SOLID:
 *   • SRP — read-only aggregation only. Writes belong in the services that
 *          own each table (agentTraining, autoDream, sub-agent orchestrator).
 *   • OCP — a new studio panel = one method here + one endpoint in v3-studio.
 *   • DIP — { pool, logger } via constructor for test injection.
 */

import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { pool } from '../db';
import { logger } from '../lib';

// ─── Types ──────────────────────────────────────────────────────────────

export interface StudioAgentSummary {
  id: string;
  slug: string;
  display_name: string;
  training_stage: 0 | 1 | 2 | 3 | 4;
  kpis: {
    revenue_usdc_mtd: number;
    hires_mtd: number;
    reputation_score: number;
    credits_earned_usdc_mtd: number;
  };
  pending_actions: {
    dream_diffs_pending: number;
    federation_broadcasts_pending: number;
  };
}

export interface StudioAgentList {
  agents: StudioAgentSummary[];
  aggregate: {
    total_revenue_usdc_mtd: number;
    total_hires_mtd: number;
    avg_reputation_score: number;
  };
}

export interface SetupChecklistStep {
  key: string;
  label: string;
  done: boolean;
  href?: string;
}

export interface StudioAgentOverview {
  agent: {
    id: string;
    slug: string;
    display_name: string;
    persona: { system_prompt?: string | null } | null;
    endpoint_url: string | null;
    last_hire_at: string | null;
  };
  training_stage: 0 | 1 | 2 | 3 | 4;
  stage_progress: {
    stage: number;
    stage_name: string;
    progress_to_next: { target_stage: number; target_name: string; requirement: string };
  };
  kpis: StudioAgentSummary['kpis'];
  setup_checklist: { score: number; ready: boolean; steps: SetupChecklistStep[] };
  pending_actions: StudioAgentSummary['pending_actions'];
}

export interface TaskRow {
  trace_id: string;
  role: 'primary' | 'sub_agent';
  duration_ms: number | null;
  total_cost_usdc: number;
  primary_revenue_usdc: number;
  sub_agent_revenue_total_usdc: number;
  platform_fee_usdc: number;
  attestation_hash: string;
  attestation_parent_hash: string | null;
  status: 'succeeded' | 'failed' | 'timeout';
  started_at: string;
  sub_agents?: Array<{ agent_id: string; slug: string; cost_usdc: number; attestation_hash: string }>;
}

export interface StudioTaskList {
  tasks: TaskRow[];
  total: number;
  aggregate_revenue_usdc: number;
}

export interface DreamRunRow {
  run_id: string;
  status: string;
  cost_usdc: number;
  phases_completed: string[];
  diff_count: number;
  hires_analyzed: number;
  started_at: string;
  finished_at: string | null;
  diffs?: Array<{
    diff_id: string;
    target_kind: string;
    target_ref: string;
    operation: string;
    old_text: string | null;
    new_text: string;
    rationale: string;
    predicted_eval_delta: number;
    status: string;
  }>;
}

export interface StudioRevenue {
  total_earned_usdc_mtd: number;
  total_earned_usdc_alltime: number;
  by_source: {
    primary_hires_usdc: number;
    sub_agent_hires_usdc: number;
    credit_pool_usdc: number;
  };
}

interface Deps {
  pool: Pool;
  logger: Logger;
}

// ─── Service ────────────────────────────────────────────────────────────

export class StudioError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export class StudioService {
  constructor(private readonly deps: Deps) {}

  // ── 1. listSellerAgents ──────────────────────────────────────────────

  async listSellerAgents(ownerAddress: string): Promise<StudioAgentList> {
    const owner = ownerAddress.toLowerCase();
    const r = await this.deps.pool.query<{
      id: string;
      slug: string;
      display_name: string;
      revenue_mtd: string;
      hires_mtd: string;
      diffs_pending: string;
    }>(
      `SELECT
         a.id,
         a.slug,
         COALESCE(a.short_description, a.slug) AS display_name,
         COALESCE(SUM(pc.amount_usdc) FILTER (
           WHERE pc.created_at >= date_trunc('month', now())
         ), 0)::text AS revenue_mtd,
         COUNT(pc.id) FILTER (
           WHERE pc.created_at >= date_trunc('month', now())
         )::text AS hires_mtd,
         (
           SELECT COUNT(*)::text FROM auto_dream_diffs d
            WHERE d.agent_id = a.id AND d.status = 'pending'
         ) AS diffs_pending
       FROM agents a
       LEFT JOIN paid_calls pc ON pc.agent_id = a.id
       WHERE LOWER(a.owner_address) = $1
         AND a.archived_at IS NULL
       GROUP BY a.id
       ORDER BY MAX(pc.created_at) DESC NULLS LAST
       LIMIT 50`,
      [owner],
    );

    const agents: StudioAgentSummary[] = [];
    for (const row of r.rows) {
      const training_stage = await this.computeTrainingStage(row.id);
      const revenue = Number(row.revenue_mtd);
      const hires = Number(row.hires_mtd);
      agents.push({
        id: row.id,
        slug: row.slug,
        display_name: row.display_name,
        training_stage,
        kpis: {
          revenue_usdc_mtd: revenue,
          hires_mtd: hires,
          reputation_score: 0, // v1.0 stub — real reputation lands in U6/v1.1
          credits_earned_usdc_mtd: 0, // v1.0 stub — surfaced from creditService in v1.1
        },
        pending_actions: {
          dream_diffs_pending: Number(row.diffs_pending),
          federation_broadcasts_pending: 0,
        },
      });
    }

    const aggregate = {
      total_revenue_usdc_mtd: agents.reduce((s, a) => s + a.kpis.revenue_usdc_mtd, 0),
      total_hires_mtd: agents.reduce((s, a) => s + a.kpis.hires_mtd, 0),
      avg_reputation_score:
        agents.length === 0 ? 0 : agents.reduce((s, a) => s + a.kpis.reputation_score, 0) / agents.length,
    };
    return { agents, aggregate };
  }

  // ── 2. getAgentOverview ─────────────────────────────────────────────────

  async getAgentOverview(agentId: string, ownerAddress: string): Promise<StudioAgentOverview> {
    await this.assertOwner(agentId, ownerAddress);
    const r = await this.deps.pool.query<{
      id: string;
      slug: string;
      display_name: string;
      persona: { system_prompt?: string | null } | null;
      endpoint_url: string | null;
      last_hire_at: string | null;
      revenue_mtd: string;
      hires_mtd: string;
      diffs_pending: string;
    }>(
      `SELECT
         a.id,
         a.slug,
         COALESCE(a.short_description, a.slug) AS display_name,
         a.persona,
         a.endpoint_url,
         (SELECT MAX(pc.created_at) FROM paid_calls pc WHERE pc.agent_id = a.id) AS last_hire_at,
         COALESCE((
           SELECT SUM(pc.amount_usdc) FROM paid_calls pc
            WHERE pc.agent_id = a.id AND pc.created_at >= date_trunc('month', now())
         ), 0)::text AS revenue_mtd,
         COALESCE((
           SELECT COUNT(pc.id) FROM paid_calls pc
            WHERE pc.agent_id = a.id AND pc.created_at >= date_trunc('month', now())
         ), 0)::text AS hires_mtd,
         COALESCE((
           SELECT COUNT(*) FROM auto_dream_diffs d
            WHERE d.agent_id = a.id AND d.status = 'pending'
         ), 0)::text AS diffs_pending
       FROM agents a
       WHERE a.id = $1
       LIMIT 1`,
      [agentId],
    );
    const row = r.rows[0];
    if (!row) throw new StudioError(404, 'agent_not_found', `agent ${agentId} not found`);

    const training_stage = await this.computeTrainingStage(agentId);
    const stage_progress = STAGE_PROGRESS_MAP[training_stage];
    const kpis: StudioAgentOverview['kpis'] = {
      revenue_usdc_mtd: Number(row.revenue_mtd),
      hires_mtd: Number(row.hires_mtd),
      reputation_score: 0,
      credits_earned_usdc_mtd: 0,
    };
    const setup_checklist = await this.computeSetupChecklist(agentId, row);

    return {
      agent: {
        id: row.id,
        slug: row.slug,
        display_name: row.display_name,
        persona: row.persona,
        endpoint_url: row.endpoint_url,
        last_hire_at: row.last_hire_at,
      },
      training_stage,
      stage_progress,
      kpis,
      setup_checklist,
      pending_actions: {
        dream_diffs_pending: Number(row.diffs_pending),
        federation_broadcasts_pending: 0,
      },
    };
  }

  // ── 3. getAgentTasks ────────────────────────────────────────────────────

  async getAgentTasks(
    agentId: string,
    ownerAddress: string,
    opts: { role: 'primary' | 'sub' | 'all'; limit: number; offset: number },
  ): Promise<StudioTaskList> {
    await this.assertOwner(agentId, ownerAddress);
    const { role, limit, offset } = opts;
    const filter =
      role === 'primary'
        ? `sah.primary_agent_id = $1 AND sah.role = 'primary'`
        : role === 'sub'
        ? `sah.sub_agent_id = $1 AND sah.role = 'sub_agent'`
        : `(sah.primary_agent_id = $1 OR sah.sub_agent_id = $1)`;

    const r = await this.deps.pool.query<{
      trace_id: string;
      role: 'primary' | 'sub_agent';
      duration_ms: number | null;
      cost_usdc: string;
      budget_split: { primary_bps: number; sub_bps: number; platform_bps: number };
      attestation_hash: string;
      parent_hash: string | null;
      status: 'succeeded' | 'failed' | 'timeout';
      started_at: string;
    }>(
      `SELECT trace_id, role, duration_ms, cost_usdc::text, budget_split,
              attestation_hash, parent_hash, status, started_at
         FROM sub_agent_hires sah
        WHERE ${filter}
        ORDER BY started_at DESC
        LIMIT $2 OFFSET $3`,
      [agentId, Math.min(100, Math.max(1, limit)), Math.max(0, offset)],
    );

    const countR = await this.deps.pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM sub_agent_hires sah WHERE ${filter}`,
      [agentId],
    );
    const total = Number(countR.rows[0]?.n ?? 0);

    // For each primary row, hydrate sub-agent hires via the trace_id.
    const tasks: TaskRow[] = [];
    for (const row of r.rows) {
      const cost = Number(row.cost_usdc);
      const split = row.budget_split ?? { primary_bps: 2000, sub_bps: 7500, platform_bps: 500 };
      const task: TaskRow = {
        trace_id: row.trace_id,
        role: row.role,
        duration_ms: row.duration_ms,
        total_cost_usdc: cost,
        primary_revenue_usdc: cost * (split.primary_bps / 10000),
        sub_agent_revenue_total_usdc: cost * (split.sub_bps / 10000),
        platform_fee_usdc: cost * (split.platform_bps / 10000),
        attestation_hash: row.attestation_hash,
        attestation_parent_hash: row.parent_hash,
        status: row.status,
        started_at: row.started_at,
      };
      if (row.role === 'primary') {
        const subs = await this.deps.pool.query<{
          sub_agent_id: string;
          slug: string;
          cost_usdc: string;
          attestation_hash: string;
        }>(
          `SELECT sah.sub_agent_id, a.slug, sah.cost_usdc::text, sah.attestation_hash
             FROM sub_agent_hires sah
             LEFT JOIN agents a ON a.id = sah.sub_agent_id
            WHERE sah.trace_id = $1 AND sah.role = 'sub_agent'
            ORDER BY sah.started_at ASC`,
          [row.trace_id],
        );
        task.sub_agents = subs.rows.map((s) => ({
          agent_id: s.sub_agent_id,
          slug: s.slug ?? '(unknown)',
          cost_usdc: Number(s.cost_usdc),
          attestation_hash: s.attestation_hash,
        }));
      }
      tasks.push(task);
    }

    const aggregate_revenue_usdc = tasks.reduce((s, t) => s + t.primary_revenue_usdc, 0);
    return { tasks, total, aggregate_revenue_usdc };
  }

  // ── 4. getDreamRuns ─────────────────────────────────────────────────────

  async getDreamRuns(agentId: string, ownerAddress: string): Promise<{ runs: DreamRunRow[] }> {
    await this.assertOwner(agentId, ownerAddress);
    const runsR = await this.deps.pool.query<{
      id: string;
      status: string;
      cost_usdc: string;
      phases_completed: string[];
      diff_count: number;
      hires_analyzed: number;
      started_at: string;
      finished_at: string | null;
    }>(
      // Filter out pure-noise runs: status='failed' with $0 cost means
      // the pipeline aborted before any LLM call fired (usually a schema
      // or fixture bug that's already been patched). Real failures — ones
      // that spent LLM money mid-flight — still surface via cost>0. User-
      // facing statuses (approved / pending_approval / rejected) always
      // surface regardless of cost.
      `SELECT id, status, cost_usdc::text, phases_completed, diff_count,
              hires_analyzed, started_at, finished_at
         FROM auto_dream_runs
        WHERE agent_id = $1
          AND (status <> 'failed' OR cost_usdc > 0)
        ORDER BY started_at DESC
        LIMIT 20`,
      [agentId],
    );

    const runs: DreamRunRow[] = [];
    for (const run of runsR.rows) {
      const diffsR = await this.deps.pool.query<{
        id: string;
        target_kind: string;
        target_ref: string;
        operation: string;
        old_text: string | null;
        new_text: string;
        rationale: string;
        predicted_eval_delta: string;
        status: string;
      }>(
        `SELECT id, target_kind, target_ref, operation, old_text, new_text,
                rationale, predicted_eval_delta::text, status
           FROM auto_dream_diffs
          WHERE run_id = $1
          ORDER BY predicted_eval_delta DESC`,
        [run.id],
      );
      runs.push({
        run_id: run.id,
        status: run.status,
        cost_usdc: Number(run.cost_usdc),
        phases_completed: run.phases_completed ?? [],
        diff_count: run.diff_count,
        hires_analyzed: run.hires_analyzed,
        started_at: run.started_at,
        finished_at: run.finished_at,
        diffs: diffsR.rows.map((d) => ({
          diff_id: d.id,
          target_kind: d.target_kind,
          target_ref: d.target_ref,
          operation: d.operation,
          old_text: d.old_text,
          new_text: d.new_text,
          rationale: d.rationale,
          predicted_eval_delta: Number(d.predicted_eval_delta),
          status: d.status,
        })),
      });
    }
    return { runs };
  }

  // ── 5. getRevenue ────────────────────────────────────────────────────────

  async getRevenue(agentId: string, ownerAddress: string): Promise<StudioRevenue> {
    await this.assertOwner(agentId, ownerAddress);
    const [mtd, all, byPrimary, bySub] = await Promise.all([
      this.deps.pool.query<{ v: string }>(
        `SELECT COALESCE(SUM(amount_usdc), 0)::text AS v
           FROM paid_calls WHERE agent_id = $1 AND created_at >= date_trunc('month', now())`,
        [agentId],
      ),
      this.deps.pool.query<{ v: string }>(
        `SELECT COALESCE(SUM(amount_usdc), 0)::text AS v FROM paid_calls WHERE agent_id = $1`,
        [agentId],
      ),
      this.deps.pool.query<{ v: string }>(
        `SELECT COALESCE(SUM(cost_usdc), 0)::text AS v
           FROM sub_agent_hires WHERE primary_agent_id = $1 AND role = 'primary'`,
        [agentId],
      ),
      this.deps.pool.query<{ v: string }>(
        `SELECT COALESCE(SUM(cost_usdc), 0)::text AS v
           FROM sub_agent_hires WHERE sub_agent_id = $1 AND role = 'sub_agent'`,
        [agentId],
      ),
    ]);
    return {
      total_earned_usdc_mtd: Number(mtd.rows[0]?.v ?? 0),
      total_earned_usdc_alltime: Number(all.rows[0]?.v ?? 0),
      by_source: {
        primary_hires_usdc: Number(byPrimary.rows[0]?.v ?? 0),
        sub_agent_hires_usdc: Number(bySub.rows[0]?.v ?? 0),
        credit_pool_usdc: 0,
      },
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private async assertOwner(agentId: string, ownerAddress: string): Promise<void> {
    const r = await this.deps.pool.query<{ owner_address: string }>(
      `SELECT owner_address FROM agents WHERE id = $1 LIMIT 1`,
      [agentId],
    );
    if (r.rowCount === 0) throw new StudioError(404, 'agent_not_found', `agent ${agentId} not found`);
    if (r.rows[0].owner_address.toLowerCase() !== ownerAddress.toLowerCase()) {
      throw new StudioError(403, 'not_owner', 'not the owner of this agent');
    }
  }

  /**
   * v1.0 training stage rubric:
   *   0 Onboarded    — agent row exists
   *   1 SkillsAdded  — ≥1 active skill
   *   2 Evaluated    — audit_last_run within 30 days on any skill
   *   3 Orchestrator — has completed ≥1 sub_agent_hires as primary
   *   4 Dreamed      — has ≥1 approved auto_dream_runs
   * Stage 2's audit-based check is a substitute for the real eval harness
   * (deferred per C11); real harness ships v1.1.
   */
  private async computeTrainingStage(agentId: string): Promise<0 | 1 | 2 | 3 | 4> {
    const r = await this.deps.pool.query<{
      has_skills: boolean;
      recent_audit: boolean;
      has_primary_hire: boolean;
      has_approved_dream: boolean;
    }>(
      `SELECT
         EXISTS (SELECT 1 FROM agent_skills WHERE agent_id = $1 AND status = 'active') AS has_skills,
         EXISTS (
           SELECT 1 FROM agent_skills
            WHERE agent_id = $1 AND status = 'active'
              AND audit_last_run > now() - interval '30 days'
         ) AS recent_audit,
         EXISTS (
           SELECT 1 FROM sub_agent_hires
            WHERE primary_agent_id = $1 AND role = 'primary' AND status = 'succeeded'
         ) AS has_primary_hire,
         EXISTS (SELECT 1 FROM auto_dream_runs WHERE agent_id = $1 AND status = 'approved') AS has_approved_dream`,
      [agentId],
    );
    const s = r.rows[0];
    if (!s) return 0;
    if (s.has_approved_dream) return 4;
    if (s.has_primary_hire) return 3;
    if (s.recent_audit) return 2;
    if (s.has_skills) return 1;
    return 0;
  }

  private async computeSetupChecklist(
    agentId: string,
    row: { display_name: string; persona: unknown; endpoint_url: string | null },
  ): Promise<StudioAgentOverview['setup_checklist']> {
    const skills = await this.deps.pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM agent_skills WHERE agent_id = $1 AND status = 'active'`,
      [agentId],
    );
    const hires = await this.deps.pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM paid_calls WHERE agent_id = $1`,
      [agentId],
    );

    const persona = row.persona as { system_prompt?: string | null } | null;
    const steps: SetupChecklistStep[] = [
      { key: 'has_display_name', label: 'Display name set', done: !!row.display_name && row.display_name.trim().length > 0 && row.display_name !== 'undefined' },
      { key: 'has_persona', label: 'Persona system prompt set', done: !!persona?.system_prompt?.trim() },
      { key: 'has_endpoint', label: 'Endpoint URL configured (optional)', done: !!row.endpoint_url },
      { key: 'has_skill', label: 'At least one active SKILL.md', done: Number(skills.rows[0]?.n ?? 0) > 0, href: `/studio/${agentId}/training` },
      { key: 'has_first_hire', label: 'Received first hire', done: Number(hires.rows[0]?.n ?? 0) > 0 },
      { key: 'has_audit', label: 'Skill audit within 30 days', done: false, href: `/studio/${agentId}/training` },
    ];
    const doneCount = steps.filter((s) => s.done).length;
    const score = Math.round((doneCount / steps.length) * 100);
    return { score, ready: doneCount === steps.length, steps };
  }
}

// ─── Stage progression static map ──────────────────────────────────────

const STAGE_PROGRESS_MAP: Record<0 | 1 | 2 | 3 | 4, StudioAgentOverview['stage_progress']> = {
  0: {
    stage: 0,
    stage_name: 'Onboarded',
    progress_to_next: { target_stage: 1, target_name: 'SkillsAdded', requirement: 'Upload your first SKILL.md' },
  },
  1: {
    stage: 1,
    stage_name: 'SkillsAdded',
    progress_to_next: { target_stage: 2, target_name: 'Evaluated', requirement: 'Run eval harness on at least one skill' },
  },
  2: {
    stage: 2,
    stage_name: 'Evaluated',
    progress_to_next: { target_stage: 3, target_name: 'Orchestrator', requirement: 'Complete at least one sub-agent hire' },
  },
  3: {
    stage: 3,
    stage_name: 'Orchestrator',
    progress_to_next: { target_stage: 4, target_name: 'Dreamed', requirement: 'Approve at least one auto-dream cycle' },
  },
  4: {
    stage: 4,
    stage_name: 'Dreamed',
    progress_to_next: { target_stage: 4, target_name: 'Dreamed', requirement: '(maxed — continue approving diffs)' },
  },
};

// ─── Singleton ─────────────────────────────────────────────────────────
export const studioService = new StudioService({ pool, logger });
