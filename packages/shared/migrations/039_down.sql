-- 039_down.sql — rollback for Agent Training Pipeline v1.0
BEGIN;
DROP TABLE IF EXISTS agent_kit_mappings;
DROP TABLE IF EXISTS agent_skills;
DROP TABLE IF EXISTS agent_kit_capabilities;
DROP TABLE IF EXISTS agent_kit_versions;
DROP TABLE IF EXISTS agent_kits;
COMMIT;
