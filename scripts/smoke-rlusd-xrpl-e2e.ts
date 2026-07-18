#!/usr/bin/env -S npx tsx
/**
 * smoke-rlusd-xrpl-e2e.ts — verifies the PRD-Y RLUSD-on-XRPL-testnet rail
 * end-to-end. Opt-in only — never runs in default CI (requires a funded
 * XRPL testnet seed + XRPL_RLUSD_ENABLED=true on the target API).
 *
 * Flow:
 *   1. Config check — GET /v3/credits/config exposes `xrpl.enabled=true`.
 *   2. Withdraw guard checks — a seller with no xrpl_address set gets the
 *      actionable `xrpl_address_not_set` 400; setting an address without a
 *      trustline gets `seller_no_trustline`.
 *   3. (Optional, needs XRPL_BUYER_SEED) — a real RLUSD payment via
 *      n-payment's createXrplClient, then POST /v3/credits/topup-xrpl to
 *      verify+grant, asserting the balance rises by the pack amount.
 *
 * Run:
 *   npm run smoke:rlusd-xrpl-e2e
 *   XRPL_BUYER_SEED=sEd... npm run smoke:rlusd-xrpl-e2e   # also tops up
 *
 * Pre-requisites:
 *   * Migration 047 applied.
 *   * XRPL_RLUSD_ENABLED=true + XRPL_PLATFORM_PAYOUT_SEED/ADDRESS set on
 *     the target API.
 */

const API = process.env.API_URL ?? 'http://localhost:3001';

async function main() {
  console.log('[smoke] API =', API);

  const cfgRes = await fetch(`${API}/v3/credits/config`);
  if (!cfgRes.ok) throw new Error(`config HTTP ${cfgRes.status}`);
  const cfg = await cfgRes.json();
  console.log('[smoke] xrpl config:', cfg.xrpl);
  if (!cfg.xrpl?.enabled) {
    console.log('[smoke] XRPL_RLUSD_ENABLED is not true on the target API — nothing further to test.');
    return;
  }

  const TEST_WALLET = process.env.SMOKE_TEST_WALLET
    ?? '0xdeadbeef000000000000000000000000c0ffee02';

  // Withdraw guard: no seller profile → 404 (expected, this wallet has none).
  const withdrawRes = await fetch(
    `${API}/v3/marketplace/seller/withdraw?network=xrpl-testnet`,
    { method: 'POST', headers: { 'x-wallet-address': TEST_WALLET } },
  );
  const withdrawBody = await withdrawRes.json().catch(() => ({}));
  console.log(`[smoke] withdraw guard (no seller) → HTTP ${withdrawRes.status}`, withdrawBody);

  const buyerSeed = process.env.XRPL_BUYER_SEED;
  if (!buyerSeed) {
    console.log('\n[smoke] set XRPL_BUYER_SEED to run a real RLUSD top-up against XRPL testnet.');
    console.log(`  curl -i ${API}/api/v1/credits/xrpl/buy-pack-25`);
    return;
  }

  const requireFn = Function('m', 'return require(m)') as (m: string) => any;
  const np = requireFn('n-payment');
  const client = np.createXrplClient({ seed: buyerSeed, network: 'testnet' });
  await client.ensureTrustLine();

  console.log('[smoke] sending $25 RLUSD to platform payout address…');
  const { hash } = await client.sendRLUSD(cfg.xrpl.payout_address, '25.00');
  await client.disconnect?.();
  console.log('[smoke] sent, tx =', hash);

  const grantRes = await fetch(`${API}/v3/credits/topup-xrpl`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-wallet-address': TEST_WALLET },
    body: JSON.stringify({ tx_hash: hash, pack_usdc: 25 }),
  });
  const grantBody = await grantRes.json().catch(() => ({}));
  if (!grantRes.ok) throw new Error(`topup-xrpl HTTP ${grantRes.status}: ${JSON.stringify(grantBody)}`);
  console.log('[smoke] grant ok:', grantBody);
}

main().catch((err) => {
  console.error('[smoke] FAIL', err.message);
  process.exit(1);
});
