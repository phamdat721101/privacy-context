-- 042_sub_agent_hires.sql
--
-- PRD-U3 — sub-agent orchestration ledger + per-agent router policy.
--   Behind flag `FEATURE_SUB_AGENT_ORCHESTRATION=false`; additive, safe
--   to leave in place with flag off.
--
-- Verification correction #1: agent_skills.trigger_patterns is ALREADY
-- jsonb (migration 039 line 90). No ALTER needed here.
--
-- Tables added (both idempotent):
--   sub_agent_hires        — ledger row per primary → sub-agent hire, with
--                            attestation chain via parent_hash
--   agent_router_policies  — one row per agent selecting one of 5 policies
--
-- Rollback: see 042_down.sql.

BEGIN;

-- ─── 1. sub_agent_hires ────────────────────────────────────────────────────
-- Each row = one hire event (primary or sub). Root of the chain is the
-- primary orchestrator (parent_hash IS NULL, role='primary'). Sub-hires
-- reference their primary via parent_hash = primary.attestation_hash.
CREATE TABLE IF NOT EXISTS sub_agent_hires (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_agent_id  uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  sub_agent_id      uuid REFERENCES agents(id) ON DELETE SET NULL,
  trace_id          text NOT NULL,
  parent_hash       text,
  attestation_hash  text NOT NULL,
  role              text NOT NULL DEFAULT 'primary',
  budget_split      jsonb NOT NULL DEFAULT '{"primary_bps":2000,"sub_bps":7500,"platform_bps":500}'::jsonb,
  cost_usdc         numeric(20, 6) NOT NULL DEFAULT 0,
  input_summary     text,
  output_summary    text,
  status            text NOT NULL DEFAULT 'succeeded',
  duration_ms       integer,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sub_agent_hires_role_chk') THEN
    ALTER TABLE sub_agent_hires ADD CONSTRAINT sub_agent_hires_role_chk
      CHECK (role IN ('primary', 'sub_agent'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sub_agent_hires_status_chk') THEN
    ALTER TABLE sub_agent_hires ADD CONSTRAINT sub_agent_hires_status_chk
      CHECK (status IN ('succeeded', 'failed', 'timeout'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS sub_agent_hires_primary_idx
  ON sub_agent_hires (primary_agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS sub_agent_hires_sub_idx
  ON sub_agent_hires (sub_agent_id, started_at DESC) WHERE sub_agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sub_agent_hires_trace_idx
  ON sub_agent_hires (trace_id);
CREATE INDEX IF NOT EXISTS sub_agent_hires_parent_idx
  ON sub_agent_hires (parent_hash) WHERE parent_hash IS NOT NULL;

-- ─── 2. agent_router_policies ──────────────────────────────────────────────
-- One row per agent that has non-default routing behavior. Absent row =
-- inherit 'reputation-aware' default at service-side. `params` is a small
-- policy-specific config bag (e.g. max_sub_agents, timeout_ms).
CREATE TABLE IF NOT EXISTS agent_router_policies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     uuid NOT NULL UNIQUE REFERENCES agents(id) ON DELETE CASCADE,
  policy       text NOT NULL DEFAULT 'reputation-aware',
  params       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_router_policies_policy_chk') THEN
    ALTER TABLE agent_router_policies ADD CONSTRAINT agent_router_policies_policy_chk
      CHECK (policy IN ('round-robin', 'lru', 'usage-aware', 'cost-aware', 'reputation-aware'));
  END IF;
END$$;

COMMIT;
