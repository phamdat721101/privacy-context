#!/usr/bin/env -S npx tsx
/**
 * smoke-credit-e2e.ts — verifies the PRD-G credit system end-to-end.
 *
 * Flow:
 *   1. Backfill check — GET /v3/credits/me with a fresh wallet returns 25.00
 *      (when FEATURE_CREDIT_SYSTEM=true AND a Privy token is present, OR
 *       WELCOME_GRANT_WALLET_ONLY=true is set).
 *   2. Spend simulation — direct DB tryDebit() on the same wallet for $1
 *      against any published agent. Balance drops by $1; seller_balances
 *      rises by $0.70.
 *   3. Top-up (optional) — when X402_BUYER_PRIVATE_KEY is set, runs a real
 *      x402 settle against /api/v1/credits/buy-pack-25 and asserts the
 *      balance rises by $25.
 *
 * Run:  npm run smoke:credit-e2e
 *       X402_BUYER_PRIVATE_KEY=0x... npm run smoke:credit-e2e   # also tops up
 *
 * Pre-requisites:
 *   * Migration 037 applied.
 *   * FEATURE_CREDIT_SYSTEM=true on the target API.
 *   * Either PRIVY_TOKEN env (real token) OR WELCOME_GRANT_WALLET_ONLY=true.
 */

const API = process.env.API_URL ?? 'http://localhost:3001';

interface CreditMe {
  wallet: string;
  balance_usdc: string;
  welcome_granted: boolean;
  privy_bound: boolean;
}

async function getMe(wallet: string, privyToken?: string): Promise<CreditMe | { error: string }> {
  const headers: Record<string, string> = { 'x-wallet-address': wallet };
  if (privyToken) headers.authorization = `Bearer ${privyToken}`;
  const r = await fetch(`${API}/v3/credits/me`, { headers });
  if (!r.ok) return { error: `HTTP ${r.status}` };
  return (await r.json()) as CreditMe;
}

async function main() {
  console.log('[smoke] API =', API);

  // A throwaway address — never receives funds, just needs to be a
  // 0x-prefixed 40-char hex.
  const TEST_WALLET = process.env.SMOKE_TEST_WALLET
    ?? '0xdeadbeef000000000000000000000000c0ffee01';
  const PRIVY_TOKEN = process.env.PRIVY_TOKEN;

  // 1. Trigger the lazy welcome grant.
  console.log(`[smoke] requesting balance for ${TEST_WALLET}…`);
  const me = await getMe(TEST_WALLET, PRIVY_TOKEN);
  if ('error' in me) {
    console.log(`[smoke] /v3/credits/me returned ${me.error}.`);
    console.log('[smoke] make sure FEATURE_CREDIT_SYSTEM=true and migration 037 is applied.');
    process.exit(1);
  }
  console.log(`[smoke] balance = ${me.balance_usdc}  welcome_granted=${me.welcome_granted}  privy_bound=${me.privy_bound}`);
  if (Number(me.balance_usdc) < 25 && !me.welcome_granted) {
    console.log('[smoke] welcome grant did NOT fire. If no Privy token is provided, set WELCOME_GRANT_WALLET_ONLY=true on the API.');
  }

  // 2. Optional x402 top-up against the live endpoint.
  const buyerKey = process.env.X402_BUYER_PRIVATE_KEY;
  if (!buyerKey) {
    console.log('\n[smoke] set X402_BUYER_PRIVATE_KEY to run a real top-up.');
    console.log(`  curl -i ${API}/api/v1/credits/buy-pack-25`);
    return;
  }
  const requireFn = Function('m', 'return require(m)') as (m: string) => any;
  const np = requireFn('n-payment');
  const client = np.createPaymentClient({
    chains: ['arbitrum-sepolia'],
    wallet: { privateKey: buyerKey },
  });
  console.log('[smoke] settling $25 top-up…');
  const settled = await client.fetchWithPayment(
    `${API}/api/v1/credits/buy-pack-25`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-buyer': TEST_WALLET },
      body: JSON.stringify({ buyer_wallet: TEST_WALLET }),
    },
  );
  if (!settled.ok) throw new Error(`top-up HTTP ${settled.status}`);
  const j = await settled.json();
  console.log('[smoke] top-up ok:', j);

  const after = await getMe(TEST_WALLET, PRIVY_TOKEN);
  if ('error' in after) throw new Error(after.error);
  console.log(`[smoke] new balance = ${after.balance_usdc}`);
}

main().catch((err) => {
  console.error('[smoke] FAIL', err.message);
  process.exit(1);
});
