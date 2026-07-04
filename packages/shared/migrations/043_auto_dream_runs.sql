-- 043_auto_dream_runs.sql
--
-- PRD-U4 — auto-dream memory consolidator ledger. Behind flag
--   `FEATURE_AUTO_DREAM=false`; additive, safe to leave in place.
--
-- Tables added (all idempotent):
--   auto_dream_runs        — one row per 4-phase cycle
--   auto_dream_diffs       — LLM-proposed skill/persona changes per run
--   auto_dream_approvals   — seller approve/reject event log
--
-- Correction #7 applied: agent_skills.status is 3-state
-- ('draft', 'active', 'archived') per mig 039 line 130; auto_dream_diffs
-- proposed changes land as draft first, flip to active on approval.
--
-- Rollback: see 043_down.sql.

BEGIN;

-- ─── 1. auto_dream_runs ────────────────────────────────────────────────────
-- One row per cycle. Cost caps + phase progression enforced at service side.
CREATE TABLE IF NOT EXISTS auto_dream_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id              uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  phases_completed      jsonb NOT NULL DEFAULT '[]'::jsonb,
  status                text NOT NULL DEFAULT 'started',
  cost_usdc             numeric(10, 4) NOT NULL DEFAULT 0,
  hires_analyzed        integer NOT NULL DEFAULT 0,
  diff_count            integer NOT NULL DEFAULT 0,
  error                 text,
  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_dream_runs_status_chk') THEN
    ALTER TABLE auto_dream_runs ADD CONSTRAINT auto_dream_runs_status_chk
      CHECK (status IN ('started', 'phase_1', 'phase_2', 'phase_3', 'phase_4',
                        'pending_approval', 'approved', 'rejected', 'failed'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS auto_dream_runs_agent_idx
  ON auto_dream_runs (agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS auto_dream_runs_status_idx
  ON auto_dream_runs (status) WHERE status = 'pending_approval';

-- ─── 2. auto_dream_diffs ──────────────────────────────────────────────────
-- LLM-proposed changes. `target_kind` selects skill/persona; `target_ref`
-- points at the agent_skills.slug (for skill diffs) or 'persona' (for
-- persona-level rewrites). `predicted_eval_delta` is the LLM's estimate of
-- eval-harness improvement; seller UI displays with confidence caveat.
CREATE TABLE IF NOT EXISTS auto_dream_diffs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                 uuid NOT NULL REFERENCES auto_dream_runs(id) ON DELETE CASCADE,
  agent_id               uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  target_kind            text NOT NULL,
  target_ref             text NOT NULL,
  operation              text NOT NULL,
  old_text               text,
  new_text               text NOT NULL,
  rationale              text NOT NULL,
  predicted_eval_delta   numeric(4, 3) NOT NULL DEFAULT 0,
  status                 text NOT NULL DEFAULT 'pending',
  created_at             timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_dream_diffs_target_kind_chk') THEN
    ALTER TABLE auto_dream_diffs ADD CONSTRAINT auto_dream_diffs_target_kind_chk
      CHECK (target_kind IN ('skill', 'persona'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_dream_diffs_operation_chk') THEN
    ALTER TABLE auto_dream_diffs ADD CONSTRAINT auto_dream_diffs_operation_chk
      CHECK (operation IN ('add', 'edit', 'delete', 'merge'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_dream_diffs_status_chk') THEN
    ALTER TABLE auto_dream_diffs ADD CONSTRAINT auto_dream_diffs_status_chk
      CHECK (status IN ('pending', 'approved', 'rejected', 'superseded'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS auto_dream_diffs_run_idx
  ON auto_dream_diffs (run_id);
CREATE INDEX IF NOT EXISTS auto_dream_diffs_pending_idx
  ON auto_dream_diffs (agent_id, status) WHERE status = 'pending';

-- ─── 3. auto_dream_approvals ──────────────────────────────────────────────
-- Immutable audit log of seller decisions. One row per approve/reject event.
-- The `signature` column stores the EIP-712 signature verified in the api.
CREATE TABLE IF NOT EXISTS auto_dream_approvals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            uuid NOT NULL REFERENCES auto_dream_runs(id) ON DELETE CASCADE,
  agent_id          uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  owner_address     text NOT NULL,
  action            text NOT NULL,
  selected_diff_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  signature         text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_dream_approvals_action_chk') THEN
    ALTER TABLE auto_dream_approvals ADD CONSTRAINT auto_dream_approvals_action_chk
      CHECK (action IN ('approve', 'reject'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS auto_dream_approvals_run_idx
  ON auto_dream_approvals (run_id);

COMMIT;
