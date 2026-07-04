-- 046_studio_indexes.sql
--
-- PRD-V — Seller Portal read-side indexes. Per simplification 2=c we
--   ship indexes only (no materialized view, no refresh cron). On-demand
--   JOINs + LIMIT 100 are fast enough at the current scale (<1000 agents,
--   <10K sub_agent_hires per month). If P95 TTFB slips past 800ms in
--   production the materialized view lands as a v1.1 patch — the studio
--   service methods can consume it without route changes.
--
-- Indexes added (all idempotent):
--   idx_sub_agent_hires_primary  — role='primary' scans
--   idx_sub_agent_hires_sub      — role='sub_agent' scans
--
-- Rollback: see 046_down.sql.
--
-- NB: migrations 042-045 are reserved for PRD-U (040 OAP, 041 typed
-- contexts, 042 sub_agent_hires, 043 auto_dream). PRD-V's index-only
-- migration jumps to 046 so the numbering matches the two locked PRDs.

BEGIN;

-- Fast lookup: "hires where this agent was the primary orchestrator,
-- newest first". Powers V4 Tasks Primary sub-tab pagination.
CREATE INDEX IF NOT EXISTS idx_sub_agent_hires_primary
  ON sub_agent_hires (primary_agent_id, started_at DESC);

-- Fast lookup: "hires where this agent was hired as a sub-agent,
-- newest first". Powers V4 Tasks Sub-Agent sub-tab pagination.
CREATE INDEX IF NOT EXISTS idx_sub_agent_hires_sub
  ON sub_agent_hires (sub_agent_id, started_at DESC)
  WHERE sub_agent_id IS NOT NULL;

COMMIT;
