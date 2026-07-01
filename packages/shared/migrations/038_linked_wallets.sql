-- 038_linked_wallets.sql
--
-- PRD-H — one OpenX profile per human, N linked wallets across chains.
-- The auth middleware upserts (chain, address) here on every verified
-- onboard-token so the very first sign-in materializes the user's row.
-- Additional wallets are attached via /v3/user/link-wallet using a second
-- verified envelope.
--
-- SOLID:
--   * SRP — this table stores wallet ↔ user linkage only. Payout routing
--     is a per-row flag; earnings ledgers live elsewhere.
--   * OCP — `chain` is a text-CHECK enum; adding a new chain (Solana,
--     Cosmos…) is one migration line, no downstream schema change.
--
-- Rollback:
--   DROP TABLE IF EXISTS linked_wallets;
CREATE TABLE IF NOT EXISTS linked_wallets (
  chain          TEXT      NOT NULL CHECK (chain IN ('evm', 'xrpl')),
  address        TEXT      NOT NULL,
  user_id        UUID      NOT NULL,
  is_payout      BOOLEAN   NOT NULL DEFAULT FALSE,
  linked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain, address)
);

-- One row per user × chain × is_payout=true — enforced at write time by
-- the service (single UPDATE flips previous payout flag off).
CREATE INDEX IF NOT EXISTS linked_wallets_user_idx ON linked_wallets(user_id);
