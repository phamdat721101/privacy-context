-- 040_down.sql — rollback for PRD-U1 OAP registration
BEGIN;
DROP TABLE IF EXISTS oap_registration_events;
DROP TABLE IF EXISTS oap_manifests;
COMMIT;
