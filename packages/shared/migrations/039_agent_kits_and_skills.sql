-- 039_agent_kits_and_skills.sql
--
-- Agent Training Pipeline v1.0 (lean MVP) — kit registry + per-agent skill
-- inventory. Behind API-side flag `FEATURE_AGENT_TRAINING_PIPELINE=false`;
-- schema is additive, safe to leave in place with flag off.
--
-- Tables added (all idempotent):
--   agent_kits              — registry of web3 agent-kits (7 seeded)
--   agent_kit_versions      — version history per kit
--   agent_kit_capabilities  — structured capability list per kit
--   agent_skills            — per-agent SKILL.md inventory
--   agent_kit_mappings      — skill → kit(s) dependency edges
--
-- Rollback: see 039_down.sql.

BEGIN;

-- ─── 1. agent_kits ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_kits (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               text NOT NULL UNIQUE,
  name               text NOT NULL,
  description        text NOT NULL,
  homepage_url       text,
  license            text NOT NULL DEFAULT 'MIT',
  authors            jsonb NOT NULL DEFAULT '[]'::jsonb,
  trigger_type       text NOT NULL DEFAULT 'user',
  leading_word       text NOT NULL,
  audit_score        numeric(3, 2) NOT NULL DEFAULT 0.0,
  audit_pillars_pass jsonb NOT NULL DEFAULT '{}'::jsonb,
  npm_package        text,
  github_repo        text,
  install_command    text,
  cost_install       text NOT NULL DEFAULT 'free',
  cost_per_use       text NOT NULL DEFAULT 'variable',
  status             text NOT NULL DEFAULT 'active',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_kits_trigger_type_chk') THEN
    ALTER TABLE agent_kits ADD CONSTRAINT agent_kits_trigger_type_chk
      CHECK (trigger_type IN ('user', 'model'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_kits_status_chk') THEN
    ALTER TABLE agent_kits ADD CONSTRAINT agent_kits_status_chk
      CHECK (status IN ('active', 'deprecated', 'sunset'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS agent_kits_status_idx ON agent_kits (status);

-- ─── 2. agent_kit_versions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_kit_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id         uuid NOT NULL REFERENCES agent_kits(id) ON DELETE CASCADE,
  version        text NOT NULL,
  release_date   timestamptz NOT NULL DEFAULT now(),
  skill_md_url   text,
  skill_md_lines integer NOT NULL DEFAULT 0,
  reference_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  changelog      text,
  is_latest      boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kit_id, version)
);

CREATE INDEX IF NOT EXISTS agent_kit_versions_kit_idx
  ON agent_kit_versions (kit_id);
CREATE UNIQUE INDEX IF NOT EXISTS agent_kit_versions_latest_uniq
  ON agent_kit_versions (kit_id) WHERE is_latest;

-- ─── 3. agent_kit_capabilities ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_kit_capabilities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id        uuid NOT NULL REFERENCES agent_kits(id) ON DELETE CASCADE,
  capability_id text NOT NULL,
  name          text NOT NULL,
  description   text,
  chains        jsonb NOT NULL DEFAULT '[]'::jsonb,
  stablecoins   jsonb NOT NULL DEFAULT '[]'::jsonb,
  eval_task_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kit_id, capability_id)
);

CREATE INDEX IF NOT EXISTS agent_kit_capabilities_kit_idx
  ON agent_kit_capabilities (kit_id);

-- ─── 4. agent_skills — per-agent SKILL.md inventory ────────────────────────
CREATE TABLE IF NOT EXISTS agent_skills (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id             uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  slug                 text NOT NULL,
  name                 text NOT NULL,
  description          text NOT NULL,
  system_prompt        text NOT NULL,
  skill_md_content     text NOT NULL,
  skill_md_lines       integer NOT NULL,
  reference_files      jsonb NOT NULL DEFAULT '[]'::jsonb,
  trigger_type         text NOT NULL DEFAULT 'user',
  leading_word         text NOT NULL,
  trigger_patterns     jsonb NOT NULL DEFAULT '[]'::jsonb,
  audit_score          numeric(3, 2) NOT NULL DEFAULT 0.0,
  audit_pillars        jsonb NOT NULL DEFAULT '{}'::jsonb,
  audit_last_run       timestamptz,
  source_type          text NOT NULL DEFAULT 'manual',
  status               text NOT NULL DEFAULT 'active',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, slug)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_skills_source_type_chk') THEN
    ALTER TABLE agent_skills ADD CONSTRAINT agent_skills_source_type_chk
      CHECK (source_type IN ('manual', 'llm_auto', 'kit_derived'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_skills_status_chk') THEN
    ALTER TABLE agent_skills ADD CONSTRAINT agent_skills_status_chk
      CHECK (status IN ('draft', 'active', 'archived'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_skills_trigger_type_chk') THEN
    ALTER TABLE agent_skills ADD CONSTRAINT agent_skills_trigger_type_chk
      CHECK (trigger_type IN ('user', 'model'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS agent_skills_agent_idx
  ON agent_skills (agent_id) WHERE status = 'active';

-- ─── 5. agent_kit_mappings — skill → kit(s) ────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_kit_mappings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id       uuid NOT NULL REFERENCES agent_skills(id) ON DELETE CASCADE,
  kit_id         uuid NOT NULL REFERENCES agent_kits(id) ON DELETE CASCADE,
  capability_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_id, kit_id)
);

CREATE INDEX IF NOT EXISTS agent_kit_mappings_skill_idx
  ON agent_kit_mappings (skill_id);
CREATE INDEX IF NOT EXISTS agent_kit_mappings_kit_idx
  ON agent_kit_mappings (kit_id);

COMMIT;
