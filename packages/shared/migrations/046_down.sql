-- 046_down.sql — rollback for PRD-V studio indexes
BEGIN;
DROP INDEX IF EXISTS idx_sub_agent_hires_primary;
DROP INDEX IF EXISTS idx_sub_agent_hires_sub;
COMMIT;
