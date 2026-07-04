-- 040_oap_registrations.sql
--
-- PRD-U1 — OpenX Agent Protocol (OAP) registration.
--   Manifest cache + registration audit log. Behind API-side flag
--   `FEATURE_OAP_REGISTRATION=false`; schema is additive, safe to leave in
--   place with flag off.
--
-- Tables added (all idempotent):
--   oap_manifests            — canonical cache of fetched/inline manifests
--   oap_registration_events  — audit log of every registration attempt
--
-- Rollback: see 040_down.sql.

BEGIN;

-- ─── 1. oap_manifests ──────────────────────────────────────────────────────
-- Idempotency: `manifest_hash` (sha256 of canonical JSON) is UNIQUE. Same
-- manifest submitted twice → same row → same `agent_id` (after registration).
-- `agent_id` is nullable so a manifest can be validated + cached before the
-- atomic agent-creation step in oapService.registerFromManifest.
CREATE TABLE IF NOT EXISTS oap_manifests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_hash  text NOT NULL UNIQUE,
  manifest_url   text,
  manifest_json  jsonb NOT NULL,
  agent_id       uuid REFERENCES agents(id) ON DELETE SET NULL,
  sig_state      text NOT NULL DEFAULT 'unsigned',
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oap_manifests_sig_state_chk') THEN
    ALTER TABLE oap_manifests ADD CONSTRAINT oap_manifests_sig_state_chk
      CHECK (sig_state IN ('unsigned', 'valid', 'invalid'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS oap_manifests_agent_idx
  ON oap_manifests (agent_id) WHERE agent_id IS NOT NULL;

-- ─── 2. oap_registration_events — audit log ────────────────────────────────
-- Every registration attempt writes a row here (accepted / rejected / error)
-- for observability. Retention is unbounded by design; small rows.
CREATE TABLE IF NOT EXISTS oap_registration_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_hash  text,
  source         text NOT NULL,
  status         text NOT NULL,
  error          text,
  agent_id       uuid REFERENCES agents(id) ON DELETE SET NULL,
  owner_address  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oap_reg_events_source_chk') THEN
    ALTER TABLE oap_registration_events ADD CONSTRAINT oap_reg_events_source_chk
      CHECK (source IN ('url', 'inline', 'nl_fallback', 'mcp'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oap_reg_events_status_chk') THEN
    ALTER TABLE oap_registration_events ADD CONSTRAINT oap_reg_events_status_chk
      CHECK (status IN ('accepted', 'rejected', 'error'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS oap_reg_events_agent_idx
  ON oap_registration_events (agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS oap_reg_events_created_idx
  ON oap_registration_events (created_at DESC);

COMMIT;
