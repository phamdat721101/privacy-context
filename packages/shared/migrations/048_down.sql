-- 048_down.sql — rollback for 048_welcome_backfill.sql
--
-- Safe to run even if 048 was never applied (WHERE clauses simply match
-- zero rows). Reverses ONLY the rows this migration created — identified
-- by meta->>'source' = 'backfill_048' on the credit_ledger row — so
-- organically-granted welcome bonuses (new users via ensureAccount()) are
-- never touched by this rollback.
--
-- Does NOT delete credit_accounts rows created by step 1 of 048 (a wallet
-- having an account row with zero balance is harmless and those rows may
-- already be referenced by other activity by the time this runs).

-- Reverse the balance bump for every account whose most recent backfill
-- ledger row is tagged 'backfill_048'.
UPDATE credit_accounts
   SET balance_usdc    = balance_usdc - 25.00,
       welcome_granted = FALSE,
       updated_at      = now()
 WHERE id IN (
   SELECT account_id FROM credit_ledger
    WHERE kind = 'welcome' AND meta->>'source' = 'backfill_048'
 );

-- Remove the tagged ledger rows.
DELETE FROM credit_ledger
 WHERE kind = 'welcome' AND meta->>'source' = 'backfill_048';
