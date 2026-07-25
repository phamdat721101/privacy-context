-- 048_welcome_backfill.sql — retroactive welcome-bonus grant for existing users
--
-- Root cause fixed by this migration + a config flip (WELCOME_GRANT_WALLET_ONLY=
-- true, see .env.example): the welcome grant in creditService.ensureAccount()
-- has never fired for anyone, because PRIVY_APP_SECRET is unset (privy_user_id
-- is always null server-side) and WELCOME_GRANT_WALLET_ONLY was also unset.
-- Migration 037's own backfill created a credit_accounts row for every
-- pre-existing wallet WITHOUT the grant (by design, per its own comment) —
-- so every current user sits at welcome_granted=false, balance_usdc=0.
--
-- This migration is additive/idempotent (safe to re-run):
--   1) Ensure every wallet ever seen (paid_calls.buyer ∪ sellers.wallet_address)
--      has a credit_accounts row — exact same union query as 037's backfill.
--   2) Insert one 'welcome' ledger row per currently-ungranted account,
--      tagged meta.source='backfill_048' so the down-migration can target
--      only these rows (never touches organically-granted welcome rows).
--   3) THEN flip welcome_granted + bump balance — ordered last so step 2's
--      `WHERE welcome_granted = false` predicate is still correct when it
--      runs (must not flip the flag before inserting the ledger row).
--
-- On re-run: step 1 is a no-op (ON CONFLICT DO NOTHING), and steps 2/3 only
-- ever touch rows where welcome_granted = false, so a second run affects
-- zero rows — no double-grant.

-- 1) Ensure every wallet ever seen has an account row (037's union, verbatim).
INSERT INTO credit_accounts (wallet_address)
SELECT DISTINCT lower(buyer) FROM paid_calls
 WHERE buyer IS NOT NULL AND buyer <> 'anonymous'
UNION
SELECT DISTINCT lower(wallet_address) FROM sellers
ON CONFLICT (wallet_address) DO NOTHING;

-- NOTE: 25.00 below must match WELCOME_CREDIT_USDC in the API's env at the
-- time this migration runs (default per .env.example). SQL migrations
-- cannot read application env vars; if WELCOME_CREDIT_USDC has been
-- customized on this deployment, edit the two literals below to match
-- before applying.

-- 2) Ledger row first (ordering matters — see header comment).
INSERT INTO credit_ledger (account_id, kind, amount_usdc, meta)
SELECT id, 'welcome', 25.00, '{"source":"backfill_048"}'::jsonb
FROM credit_accounts
WHERE welcome_granted = false;

-- 3) Flip the flag + bump the balance for the same row set.
UPDATE credit_accounts
   SET balance_usdc    = balance_usdc + 25.00,
       welcome_granted = TRUE,
       updated_at      = now()
 WHERE welcome_granted = false;
