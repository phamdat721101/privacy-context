-- 042_down.sql — rollback for PRD-U3 sub-agent orchestration
BEGIN;
DROP TABLE IF EXISTS agent_router_policies;
DROP TABLE IF EXISTS sub_agent_hires;
COMMIT;
