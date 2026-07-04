-- 043_down.sql — rollback for PRD-U4 auto-dream memory consolidator
BEGIN;
DROP TABLE IF EXISTS auto_dream_approvals;
DROP TABLE IF EXISTS auto_dream_diffs;
DROP TABLE IF EXISTS auto_dream_runs;
COMMIT;
