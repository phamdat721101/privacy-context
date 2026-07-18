-- 047_down.sql — rollback for 047_xrpl_rlusd_rail.sql
--
-- Safe to run even if 047 was never applied (IF EXISTS everywhere).
-- Reverts seller_balances' PK back to (seller_id) — only safe if no
-- xrpl-testnet rows exist yet (fresh rollback before any RLUSD activity).
-- If XRPL rows exist, this DELETE is required first or the PK-narrowing
-- ALTER will fail on duplicate seller_id values across networks.

DELETE FROM seller_balances WHERE network = 'xrpl-testnet';
DELETE FROM credit_ledger WHERE network = 'xrpl-testnet';

ALTER TABLE seller_balances DROP CONSTRAINT IF EXISTS seller_balances_pkey;
ALTER TABLE seller_balances
  ADD CONSTRAINT seller_balances_pkey PRIMARY KEY (seller_id);

ALTER TABLE seller_balances DROP CONSTRAINT IF EXISTS seller_balances_network_check;
ALTER TABLE seller_balances DROP COLUMN IF EXISTS network;

ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_network_check;

ALTER TABLE sellers DROP COLUMN IF EXISTS xrpl_address;
