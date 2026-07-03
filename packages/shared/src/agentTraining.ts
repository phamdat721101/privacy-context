// packages/shared/src/agentTraining.ts
//
// Shared types for Agent Training Pipeline v1.0 (kit registry + per-agent
// SKILL.md inventory). Re-exported via `packages/shared/src/index.ts`.
//
// SOLID: pure data shapes; no runtime behavior. API + SDK + frontend all
// consume the same types → no drift.

export interface AgentKit {
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

export interface AgentKitVersion {
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

export interface AgentKitCapability {
  id: string;
  kit_id: string;
  capability_id: string;
  name: string;
  description: string | null;
  chains: string[];
  stablecoins: string[];
  eval_task_ids: string[];
}

/** Full kit response as returned by `GET /v3/kits/:slug`. */
export interface AgentKitDetail {
  kit: AgentKit;
  latest_version: AgentKitVersion | null;
  capabilities: AgentKitCapability[];
}

/** Per-agent skill row (SKILL.md ingested manually in v1). */
export interface AgentSkill {
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

/** Result of the SKILL.md 4-pillar audit gate (Matt Pocock rubric, minimal MVP). */
export interface SkillAuditResult {
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

/** Payload for `POST /v3/agents/:id/skills`. */
export interface SkillUploadRequest {
  skill_md_content: string;
  kit_slugs?: string[];
}

/** Payload for `openx_agent_introspect` MCP tool + `GET /v3/agents/:id/introspect`. */
export interface AgentIntrospection {
  agent_id: string;
  slug: string | null;
  name: string;
  description: string | null;
  owner_address: string;
  price_per_query_usdc: string | null;
  kits: Array<{ kit_slug: string; capability_ids: string[]; first_used_at: string }>;
  skills: Array<Pick<AgentSkill, 'slug' | 'name' | 'description' | 'leading_word' | 'audit_score' | 'source_type'>>;
}
