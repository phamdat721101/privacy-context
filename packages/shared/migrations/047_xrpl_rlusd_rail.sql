-- 047_xrpl_rlusd_rail.sql — RLUSD-on-XRPL-testnet credit rail (additive)
--
-- Supersedes docs/prd/PRD-X-rlusd-xrpl-rail.md, which specced a
-- multi-network ledger + xrpl_trustlines table that was never implemented
-- (verified: no 047 migration, no xrplAdapter.ts, no xrpl_trustlines table
-- existed anywhere in the repo prior to this file). This migration ships a
-- narrower, code-verified design instead:
--
--   * credit_ledger.network / seller_balances.network — segregate accrual
--     per settlement network so a seller's RLUSD earnings and USDC earnings
--     never mix (Arbitrum stays the default; XRPL is additive/opt-in).
--   * sellers.xrpl_address — self-reported, unverified payout address
--     (v1: no signature challenge, matches payout_method's existing trust
--     level for the wallet-based flow).
--
-- SOLID:
--   * SRP — schema only. No behavior change; creditService.ts (edited
--     separately) is still the sole writer for these tables.
--   * OCP — `network` is a CHECK-list extension point, same pattern as
--     credit_ledger.kind in 037_credit_system.sql.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + conditional constraint drops
-- throughout. Safe to re-run. No DROPs on existing columns/tables/rows —
-- existing Arbitrum data is untouched (network defaults to
-- 'arbitrum-sepolia', matching today's implicit single-network behavior).

-- 1) credit_ledger — tag which network a purchase/spend/payout settled on.
ALTER TABLE credit_ledger
  ALTER COLUMN network SET DEFAULT 'arbitrum-sepolia';

UPDATE credit_ledger SET network = 'arbitrum-sepolia' WHERE network IS NULL;

ALTER TABLE credit_ledger
  ALTER COLUMN network SET NOT NULL;

ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_network_check;
ALTER TABLE credit_ledger
  ADD CONSTRAINT credit_ledger_network_check
  CHECK (network IN ('arbitrum-sepolia', 'xrpl-testnet'));

CREATE INDEX IF NOT EXISTS credit_ledger_network_idx
  ON credit_ledger (network, created_at DESC);

-- 2) seller_balances — segregate accrual per network. The existing table
--    has PRIMARY KEY (seller_id), one row per seller; we widen the key to
--    (seller_id, network) so a seller can hold separate accrued/withdrawn
--    balances per settlement rail (Q2: fungible within a network,
--    segregated across networks — never auto-converted).
ALTER TABLE seller_balances
  ADD COLUMN IF NOT EXISTS network TEXT NOT NULL DEFAULT 'arbitrum-sepolia';

ALTER TABLE seller_balances DROP CONSTRAINT IF EXISTS seller_balances_network_check;
ALTER TABLE seller_balances
  ADD CONSTRAINT seller_balances_network_check
  CHECK (network IN ('arbitrum-sepolia', 'xrpl-testnet'));

-- Replace the old single-column PK with a composite (seller_id, network)
-- PK. Existing rows all get network='arbitrum-sepolia' via the DEFAULT
-- above, so this is a pure widening — no data loss, no row changes besides
-- the new column's default value.
ALTER TABLE seller_balances DROP CONSTRAINT IF EXISTS seller_balances_pkey;
ALTER TABLE seller_balances
  ADD CONSTRAINT seller_balances_pkey PRIMARY KEY (seller_id, network);

CREATE INDEX IF NOT EXISTS seller_balances_network_idx
  ON seller_balances (network, seller_id);

-- 3) sellers — self-reported XRPL payout address (Q6: unverified, editable
--    anytime via PATCH /v3/marketplace/seller/me, independent of withdraw).
ALTER TABLE sellers
  ADD COLUMN IF NOT EXISTS xrpl_address VARCHAR(64);
