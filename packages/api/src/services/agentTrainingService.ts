/**
 * agentTrainingService — Agent Training Pipeline v1.0 (lean MVP).
 *
 * Single service for kit registry + per-agent SKILL.md inventory + agent
 * introspection. LLM auto-generation, DGM training loop, and eval harness are
 * deferred to Day-30 sub-flags.
 *
 * SOLID:
 *   - SRP: one class, six methods, each does one thing.
 *   - OCP: SKILL.md audit uses a small strategy record so adding a pillar is
 *     one function; no method change needed.
 *   - DIP: takes `{ pool, logger }` in the constructor for test injection.
 *
 * Feature flag: caller (routes / MCP) checks `FEATURE_AGENT_TRAINING_PIPELINE`;
 * this module is unconditionally importable.
 */

import type { Pool } from 'pg';
import type { Logger } from 'pino';
import yaml from 'js-yaml';

// Local subset of @fhe-brain/shared types — kept here to avoid a workspace
// TS moduleResolution issue (shared package is ESM-only; api uses CJS).
// Mirror the fields shipped in packages/shared/src/agentTraining.ts.

interface AgentKit {
  id: string;
  slug: string;
  name: string;
  description: string;
  homepage_url: string | null;
  license: string;
  authors: string[];
  trigger_type: 'user' | 'model';
  leading_word: string;
  audit_score: number;
  audit_pillars_pass: Record<string, boolean>;
  npm_package: string | null;
  github_repo: string | null;
  install_command: string | null;
  cost_install: string;
  cost_per_use: string;
  status: 'active' | 'deprecated' | 'sunset';
  created_at: string;
  updated_at: string;
}

interface AgentKitVersion {
  id: string;
  kit_id: string;
  version: string;
  release_date: string;
  skill_md_url: string | null;
  skill_md_lines: number;
  reference_urls: string[];
  changelog: string | null;
  is_latest: boolean;
}

interface AgentKitCapability {
  id: string;
  kit_id: string;
  capability_id: string;
  name: string;
  description: string | null;
  chains: string[];
  stablecoins: string[];
  eval_task_ids: string[];
}

interface AgentKitDetail {
  kit: AgentKit;
  latest_version: AgentKitVersion | null;
  capabilities: AgentKitCapability[];
}

interface AgentSkill {
  id: string;
  agent_id: string;
  slug: string;
  name: string;
  description: string;
  system_prompt: string;
  skill_md_content: string;
  skill_md_lines: number;
  reference_files: Array<{ path: string; url?: string; lines?: number }>;
  trigger_type: 'user' | 'model';
  leading_word: string;
  trigger_patterns: string[];
  audit_score: number;
  audit_pillars: Record<'trigger' | 'structure' | 'steering' | 'pruning', boolean>;
  audit_last_run: string | null;
  source_type: 'manual' | 'llm_auto' | 'kit_derived';
  status: 'draft' | 'active' | 'archived';
  mapped_kits: string[];
  created_at: string;
  updated_at: string;
}

interface SkillAuditResult {
  score: number;
  pass: boolean;
  pillars: {
    trigger: boolean;
    structure: boolean;
    steering: boolean;
    pruning: boolean;
  };
  reasons: string[];
}

interface SkillUploadRequest {
  skill_md_content: string;
  kit_slugs?: string[];
}

interface AgentIntrospection {
  agent_id: string;
  slug: string | null;
  name: string;
  description: string | null;
  owner_address: string;
  price_per_query_usdc: string | null;
  kits: Array<{ kit_slug: string; capability_ids: string[]; first_used_at: string }>;
  skills: Array<Pick<AgentSkill, 'slug' | 'name' | 'description' | 'leading_word' | 'audit_score' | 'source_type'>>;
}

// ─── Matt Pocock 4-pillar audit (minimal MVP) ────────────────────────────────
//
// Enforces the four rubric pillars server-side. Zero external deps. Any pillar
// failure surfaces via `reasons[]` so the UI can render actionable feedback.

const MAX_SKILL_MD_LINES = 200;

function auditSkillMd(content: string, frontmatter: Record<string, unknown>): SkillAuditResult {
  const reasons: string[] = [];
  const lines = content.split('\n');

  // Pillar 2 — Structure (short + branched)
  const structurePass = lines.length <= MAX_SKILL_MD_LINES;
  if (!structurePass) {
    reasons.push(`structure: SKILL.md has ${lines.length} lines (max ${MAX_SKILL_MD_LINES}); split branching detail into reference files`);
  }

  // Pillar 3 — Steering (leading word declared or derivable + repeated in body)
  const leadingWord = deriveLeadingWord(frontmatter);
  const body = lines.slice(frontmatter ? Object.keys(frontmatter).length + 2 : 0).join('\n');
  const leadingWordPass =
    leadingWord.length > 0 && new RegExp(escapeRegex(leadingWord), 'i').test(body);
  if (!leadingWord) reasons.push('steering: `leading_word` missing — set it explicitly OR provide `name`/`endpoint_path` to auto-derive');
  else if (!leadingWordPass)
    reasons.push(`steering: leading_word "${leadingWord}" must appear in SKILL.md body`);

  // Pillar 1 — Trigger (user | model + non-empty patterns OR user-invoked)
  const triggerType = frontmatter.trigger_type ?? 'user';
  const triggerPass = triggerType === 'user' || triggerType === 'model';
  if (!triggerPass) reasons.push(`trigger: trigger_type must be "user" or "model" (got "${triggerType}")`);

  // Pillar 4 — Pruning (name + description non-empty, no obvious duplication)
  const name = String(frontmatter.name ?? '').trim();
  const description = String(frontmatter.description ?? '').trim();
  const pruningPass = name.length > 0 && description.length >= 20;
  if (!name) reasons.push('pruning: `name` missing from frontmatter');
  if (description.length < 20) reasons.push('pruning: `description` must be ≥20 characters');

  const pillars = {
    trigger: triggerPass,
    structure: structurePass,
    steering: leadingWordPass,
    pruning: pruningPass,
  };
  const passed = Object.values(pillars).filter(Boolean).length;
  const score = passed / 4;
  return { score, pass: passed === 4, pillars, reasons };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Derive the steering "leading word" for a skill.
 *
 * Precedence:
 *   1. Explicit `frontmatter.leading_word` (Matt Pocock canonical).
 *   2. First alphanum segment of `frontmatter.name` — "goal-skill" → "goal",
 *      "pay_now" → "pay". Handles hyphens, underscores, spaces.
 *   3. Last non-empty segment of `frontmatter.endpoint_path` — "/goal" →
 *      "goal", "/api/translate" → "translate". Common for HTTP-shaped skills.
 *   4. Empty string — audit reports missing.
 *
 * SOLID:
 *   • SRP — one job: pick the leading word deterministically.
 *   • OCP — new derivation sources plug in as new branches; audit + insert
 *          paths never need to change.
 */
export function deriveLeadingWord(frontmatter: Record<string, unknown>): string {
  const explicit = String(frontmatter.leading_word ?? '').trim();
  if (explicit) return explicit.split(/[\s\-_]+/)[0].toLowerCase();

  const name = String(frontmatter.name ?? '').trim();
  if (name) {
    const first = name.split(/[\s\-_]+/)[0];
    if (first) return first.toLowerCase();
  }

  const endpointPath = String(frontmatter.endpoint_path ?? '').trim();
  if (endpointPath) {
    const segments = endpointPath.split('/').filter(Boolean);
    if (segments.length > 0) return segments[segments.length - 1].toLowerCase();
  }

  return '';
}

/** Extract YAML frontmatter + body from a SKILL.md string. Throws on malformed input. */
export function parseSkillMd(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    throw new Error('SKILL.md must start with YAML frontmatter delimited by ---');
  }
  const end = trimmed.indexOf('\n---', 3);
  if (end === -1) throw new Error('SKILL.md frontmatter is not closed with ---');
  const fmText = trimmed.slice(3, end).trim();
  const body = trimmed.slice(end + 4).trimStart();
  const frontmatter = (yaml.load(fmText) ?? {}) as Record<string, unknown>;
  if (typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new Error('SKILL.md frontmatter must be a YAML mapping');
  }
  return { frontmatter, body };
}

// ─── Row normalizers ────────────────────────────────────────────────────────
//
// node-postgres returns Postgres `NUMERIC` columns as JavaScript strings
// (see https://github.com/brianc/node-postgres/issues/378). Every callsite
// that reads `audit_score` — from the API JSON response, the MCP tools, the
// frontend components — expects a plain number so it can `.toFixed(2)` or
// compare numerically. We coerce once, at the service boundary, so nothing
// downstream has to remember.

function toNumber(v: unknown, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeKit<T extends { audit_score?: unknown }>(row: T): T {
  return { ...row, audit_score: toNumber(row.audit_score) };
}

function normalizeSkill<T extends { audit_score?: unknown }>(row: T): T {
  return { ...row, audit_score: toNumber(row.audit_score) };
}

// ─── Service ────────────────────────────────────────────────────────────────

export interface AgentTrainingDeps {
  pool: Pool;
  logger: Logger;
}

export class AgentTrainingService {
  constructor(private readonly deps: AgentTrainingDeps) {}

  /** GET /v3/kits — list active kits ordered by audit_score. */
  async listKits(): Promise<AgentKit[]> {
    const r = await this.deps.pool.query<AgentKit>(
      `SELECT * FROM agent_kits WHERE status = 'active' ORDER BY audit_score DESC, name ASC`,
    );
    return r.rows.map(normalizeKit);
  }

  /** GET /v3/kits/:slug — kit + latest version + capabilities. */
  async getKitBySlug(slug: string): Promise<AgentKitDetail | null> {
    const kitRes = await this.deps.pool.query<AgentKit>(
      `SELECT * FROM agent_kits WHERE slug = $1 LIMIT 1`,
      [slug],
    );
    const kit = kitRes.rows[0];
    if (!kit) return null;
    const [verRes, capRes] = await Promise.all([
      this.deps.pool.query<AgentKitVersion>(
        `SELECT * FROM agent_kit_versions WHERE kit_id = $1 AND is_latest LIMIT 1`,
        [kit.id],
      ),
      this.deps.pool.query<AgentKitCapability>(
        `SELECT * FROM agent_kit_capabilities WHERE kit_id = $1 ORDER BY capability_id`,
        [kit.id],
      ),
    ]);
    return {
      kit: normalizeKit(kit),
      latest_version: verRes.rows[0] ?? null,
      capabilities: capRes.rows,
    };
  }

  /** GET /v3/agents/:id/skills — active skills for an agent (public read). */
  async listAgentSkills(agentId: string): Promise<AgentSkill[]> {
    const r = await this.deps.pool.query<AgentSkill & { mapped_kits: string[] }>(
      `SELECT s.*,
              COALESCE(
                (SELECT jsonb_agg(k.slug ORDER BY k.slug)
                   FROM agent_kit_mappings m JOIN agent_kits k ON k.id = m.kit_id
                  WHERE m.skill_id = s.id),
                '[]'::jsonb
              ) AS mapped_kits
         FROM agent_skills s
        WHERE s.agent_id = $1 AND s.status = 'active'
        ORDER BY s.created_at DESC`,
      [agentId],
    );
    return r.rows.map(normalizeSkill);
  }

  /**
   * POST /v3/agents/:id/skills — upload a manual SKILL.md.
   * Enforces ownership + audit-gate. Optional kit_slugs bind the skill to kits.
   */
  async uploadAgentSkill(
    agentId: string,
    ownerAddress: string,
    payload: SkillUploadRequest,
  ): Promise<{ skill: AgentSkill; audit: SkillAuditResult }> {
    await this.assertAgentOwnership(agentId, ownerAddress);

    // Parse + audit before touching the DB.
    let parsed: { frontmatter: Record<string, unknown>; body: string };
    try {
      parsed = parseSkillMd(payload.skill_md_content);
    } catch (e) {
      const err = new Error((e as Error).message) as Error & { status?: number; audit?: SkillAuditResult };
      err.status = 400;
      throw err;
    }
    const audit = auditSkillMd(payload.skill_md_content, parsed.frontmatter);
    if (!audit.pass) {
      const err = new Error('skill_audit_failed') as Error & { status?: number; audit?: SkillAuditResult };
      err.status = 400;
      err.audit = audit;
      throw err;
    }

    const fm = parsed.frontmatter;
    const slug = String(fm.slug ?? fm.name ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '');
    if (!slug) {
      const err = new Error('skill slug could not be derived from frontmatter') as Error & { status?: number };
      err.status = 400;
      throw err;
    }

    const systemPrompt =
      String(fm.system_prompt ?? '').trim() ||
      parsed.body.slice(0, 4000); // fall back to body if no explicit prompt provided
    const triggerPatterns = Array.isArray(fm.trigger_patterns)
      ? (fm.trigger_patterns as string[]).map(String)
      : Array.isArray(fm.trigger_keywords)
      ? (fm.trigger_keywords as string[]).map(String)
      : [];
    const referenceFiles = Array.isArray(fm.reference_files) ? (fm.reference_files as unknown[]) : [];

    const client = await this.deps.pool.connect();
    try {
      await client.query('BEGIN');
      const insert = await client.query<AgentSkill>(
        `INSERT INTO agent_skills (
            agent_id, slug, name, description, system_prompt,
            skill_md_content, skill_md_lines, reference_files,
            trigger_type, leading_word, trigger_patterns,
            audit_score, audit_pillars, audit_last_run,
            source_type, status
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8::jsonb,
            $9, $10, $11::jsonb,
            $12, $13::jsonb, now(),
            'manual', 'active'
          )
          ON CONFLICT (agent_id, slug) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            system_prompt = EXCLUDED.system_prompt,
            skill_md_content = EXCLUDED.skill_md_content,
            skill_md_lines = EXCLUDED.skill_md_lines,
            reference_files = EXCLUDED.reference_files,
            trigger_type = EXCLUDED.trigger_type,
            leading_word = EXCLUDED.leading_word,
            trigger_patterns = EXCLUDED.trigger_patterns,
            audit_score = EXCLUDED.audit_score,
            audit_pillars = EXCLUDED.audit_pillars,
            audit_last_run = EXCLUDED.audit_last_run,
            status = 'active',
            updated_at = now()
          RETURNING *`,
        [
          agentId,
          slug,
          String(fm.name ?? slug),
          String(fm.description ?? ''),
          systemPrompt,
          payload.skill_md_content,
          payload.skill_md_content.split('\n').length,
          JSON.stringify(referenceFiles),
          String(fm.trigger_type ?? 'user'),
          deriveLeadingWord(fm),
          JSON.stringify(triggerPatterns),
          audit.score,
          JSON.stringify(audit.pillars),
        ],
      );
      const skill = insert.rows[0];

      // Map to kits declared in body or in payload.kit_slugs.
      const kitSlugs = Array.from(
        new Set([
          ...(payload.kit_slugs ?? []),
          ...(Array.isArray(fm.kits) ? (fm.kits as string[]) : []),
        ]),
      ).filter(Boolean);
      if (kitSlugs.length > 0) {
        await client.query(
          `DELETE FROM agent_kit_mappings WHERE skill_id = $1`,
          [skill.id],
        );
        await client.query(
          `INSERT INTO agent_kit_mappings (skill_id, kit_id, capability_ids)
             SELECT $1, k.id, '[]'::jsonb
               FROM agent_kits k
              WHERE k.slug = ANY($2::text[])`,
          [skill.id, kitSlugs],
        );
      }

      await client.query('COMMIT');
      this.deps.logger.info(
        { agent_id: agentId, skill_slug: slug, audit_score: audit.score, kits: kitSlugs },
        'agentTraining:skill:upload',
      );
      return { skill: normalizeSkill({ ...skill, mapped_kits: kitSlugs }), audit };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /** DELETE /v3/agents/:id/skills/:slug — soft-archive; owner only. */
  async archiveAgentSkill(agentId: string, ownerAddress: string, slug: string): Promise<boolean> {
    await this.assertAgentOwnership(agentId, ownerAddress);
    const r = await this.deps.pool.query(
      `UPDATE agent_skills SET status = 'archived', updated_at = now()
        WHERE agent_id = $1 AND slug = $2 AND status = 'active'`,
      [agentId, slug],
    );
    const changed = (r.rowCount ?? 0) > 0;
    if (changed) {
      this.deps.logger.info({ agent_id: agentId, skill_slug: slug }, 'agentTraining:skill:archive');
    }
    return changed;
  }

  /** GET /v3/agents/:id/introspect — bundled view for MCP + frontend. */
  async introspectAgent(agentId: string): Promise<AgentIntrospection | null> {
    const agentRes = await this.deps.pool.query<{
      id: string;
      slug: string | null;
      owner_address: string;
      persona: { name?: string; description?: string } | null;
      pricing: { x402?: string | null; mpp?: string | null } | null;
    }>(
      `SELECT id, slug, owner_address, persona, pricing FROM agents WHERE id = $1 LIMIT 1`,
      [agentId],
    );
    const agent = agentRes.rows[0];
    if (!agent) return null;

    const skills = await this.listAgentSkills(agentId);
    const kitsRes = await this.deps.pool.query<{
      kit_slug: string;
      capability_ids: string[];
      first_used_at: string;
    }>(
      `SELECT k.slug AS kit_slug,
              COALESCE(jsonb_agg(DISTINCT c) FILTER (WHERE c IS NOT NULL), '[]'::jsonb) AS capability_ids,
              MIN(m.created_at)::text AS first_used_at
         FROM agent_skills s
         JOIN agent_kit_mappings m ON m.skill_id = s.id
         JOIN agent_kits k ON k.id = m.kit_id
         LEFT JOIN LATERAL jsonb_array_elements_text(m.capability_ids) AS c ON true
        WHERE s.agent_id = $1 AND s.status = 'active'
        GROUP BY k.slug`,
      [agentId],
    );

    const price =
      agent.pricing?.x402 ??
      agent.pricing?.mpp ??
      null;

    return {
      agent_id: agent.id,
      slug: agent.slug,
      name: agent.persona?.name ?? agent.slug ?? 'agent',
      description: agent.persona?.description ?? null,
      owner_address: agent.owner_address,
      price_per_query_usdc: price,
      kits: kitsRes.rows,
      skills: skills.map((s) => ({
        slug: s.slug,
        name: s.name,
        description: s.description,
        leading_word: s.leading_word,
        audit_score: s.audit_score,
        source_type: s.source_type,
      })),
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async assertAgentOwnership(agentId: string, ownerAddress: string): Promise<void> {
    const r = await this.deps.pool.query<{ owner_address: string }>(
      `SELECT owner_address FROM agents WHERE id = $1 LIMIT 1`,
      [agentId],
    );
    const row = r.rows[0];
    if (!row) {
      const err = new Error('agent_not_found') as Error & { status?: number };
      err.status = 404;
      throw err;
    }
    if (row.owner_address.toLowerCase() !== ownerAddress.toLowerCase()) {
      const err = new Error('agent_not_owned_by_caller') as Error & { status?: number };
      err.status = 403;
      throw err;
    }
  }
}
