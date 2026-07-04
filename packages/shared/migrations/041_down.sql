-- 041_down.sql — rollback for PRD-U2 typed context envelope history
BEGIN;
DROP TABLE IF EXISTS oap_context_envelopes;
COMMIT;
