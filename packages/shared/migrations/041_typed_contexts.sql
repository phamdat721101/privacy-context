-- 041_typed_contexts.sql
--
-- PRD-U2 — OAP typed context envelope history.
--   Stores the last 30 days of envelopes flowing over the wire, keyed by
--   `trace_id` so PRD-U4 auto-dream can sample them for consolidation and
--   PRD-V4 can render the attestation chain. Behind flag
--   `FEATURE_TYPED_CONTEXT=false`; additive, safe to leave in place.
--
-- Tables added (all idempotent):
--   oap_context_envelopes  — 30-day envelope history + parent chain
--
-- Rollback: see 041_down.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS oap_context_envelopes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id       text NOT NULL,
  agent_id       uuid REFERENCES agents(id) ON DELETE SET NULL,
  parent_hash    text,
  envelope_json  jsonb NOT NULL,
  intent_type    text,
  input_tokens   integer,
  output_tokens  integer,
  status         text NOT NULL DEFAULT 'accepted',
  created_at     timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oap_context_envelopes_status_chk') THEN
    ALTER TABLE oap_context_envelopes ADD CONSTRAINT oap_context_envelopes_status_chk
      CHECK (status IN ('accepted', 'rejected'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS oap_ctx_env_trace_idx
  ON oap_context_envelopes (trace_id);
CREATE INDEX IF NOT EXISTS oap_ctx_env_agent_created_idx
  ON oap_context_envelopes (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS oap_ctx_env_parent_idx
  ON oap_context_envelopes (parent_hash) WHERE parent_hash IS NOT NULL;

COMMIT;
