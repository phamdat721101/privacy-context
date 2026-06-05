/**
 * smoke-tatum.ts — Tatum integration regression.
 *
 * Modes:
 *   DRY  (default): MockTatumClient + interface contract checks. CI-safe — burns no Tatum credits.
 *   LIVE (env TATUM_API_KEY=… set): real TatumClient against Tatum mainnet/testnet.
 *
 *   npm run smoke:tatum                     # DRY
 *   TATUM_API_KEY=t-… npm run smoke:tatum   # LIVE (manual; never wired into CI)
 *
 * LIVE mode also asserts:
 *   - WAL/USD rate is in [0.001, 100) range (sanity)
 *   - subscribe + unsubscribe round-trip on a throwaway address
 *   - sui_getObject returns exists=true for the canonical Sui Clock object 0x6
 *   - Walrus aggregator HEAD probe responds (existence-of-known-blob optional)
 */

import {
  TatumClient,
  MockTatumClient,
  TatumKeyMissingError,
  TatumChainNotSupportedError,
  type ITatumClient,
} from '../packages/api/src/services/tatumClient';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, info?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}`, info ?? '');
  }
}

const LIVE = !!process.env.TATUM_API_KEY;

async function dryChecks(client: ITatumClient) {
  console.log('\n— DRY checks (MockTatumClient interface contract) —\n');
  const sub = await client.subscribeAddress('0xabc', 'https://example.com/hook');
  ok('subscribeAddress returns { id }', typeof sub.id === 'string' && sub.id.length > 0);
  await client.unsubscribeAddress(sub.id);
  ok('unsubscribeAddress is idempotent (no throw)', true);

  const rate = await client.getWalUsdRate();
  ok('getWalUsdRate returns positive number', rate.usdPerWal > 0);
  ok('getWalUsdRate has cached + updatedAt fields', 'cached' in rate && 'updatedAt' in rate);

  const live = await client.getSuiObject('0xfake-object');
  ok('getSuiObject returns { exists: true } for non-empty id', live.exists === true);
  const dead = await client.getSuiObject('0x0');
  ok('getSuiObject returns { exists: false } for 0x0', dead.exists === false);

  const blob = await client.getWalrusBlob('walrus:abc');
  ok('getWalrusBlob returns { exists: true } for non-sentinel id', blob.exists === true);
  const missing = await client.getWalrusBlob('walrus:missing');
  ok('getWalrusBlob returns { exists: false } for sentinel "missing"', missing.exists === false);
}

async function keyMissingChecks() {
  console.log('\n— Key-missing semantics on real client —\n');
  const c = new TatumClient({ apiKey: undefined, suiNetwork: 'testnet' });

  // subscribe / unsubscribe must throw TatumKeyMissingError.
  let caughtSub = false;
  try {
    await c.subscribeAddress('0xabc', 'https://x');
  } catch (e) {
    caughtSub = e instanceof TatumKeyMissingError;
  }
  ok('subscribeAddress throws TatumKeyMissingError when key absent', caughtSub);

  let caughtUnsub = false;
  try {
    await c.unsubscribeAddress('mock');
  } catch (e) {
    caughtUnsub = e instanceof TatumKeyMissingError;
  }
  ok('unsubscribeAddress throws TatumKeyMissingError when key absent', caughtUnsub);

  // Rate must STILL return (graceful fallback).
  const rate = await c.getWalUsdRate();
  ok('getWalUsdRate still returns when key absent (fallback)', rate.usdPerWal > 0);
}

async function liveChecks(client: TatumClient) {
  console.log('\n— LIVE checks against real Tatum testnet —\n');

  // 1. WAL/USD rate.
  const rate = await client.getWalUsdRate();
  console.log('     WAL/USD rate sample:', rate);
  ok('LIVE: WAL/USD rate sane', rate.usdPerWal > 0.001 && rate.usdPerWal < 100);

  // 2. sui_getObject — canonical Sui Clock object id 0x6 must exist on testnet.
  const clock = await client.getSuiObject('0x0000000000000000000000000000000000000000000000000000000000000006');
  console.log('     Sui Clock 0x6 lookup:', clock);
  ok('LIVE: Sui Gateway returns exists=true for Sui Clock 0x6', clock.exists === true);

  // 3. Walrus aggregator probe — try a deliberately-non-existent blob; server should respond 404 gracefully.
  const fakeBlob = await client.getWalrusBlob('walrus:0000000000000000000000000000000000000000000');
  console.log('     Walrus probe result:', fakeBlob);
  ok('LIVE: Walrus aggregator reachable (probe returns shape)', typeof fakeBlob.exists === 'boolean');

  // 4. Notifications — Sui must throw TatumChainNotSupportedError (Tatum's enum doesn't include Sui as of 2026-06-04).
  let suiThrew = false;
  try {
    await client.subscribeAddress(
      '0x' + '7'.repeat(64),
      'https://example.com/openx-tatum-smoke',
      'SUI',
    );
  } catch (e) {
    suiThrew = e instanceof TatumChainNotSupportedError;
  }
  ok('LIVE: subscribe Sui throws TatumChainNotSupportedError', suiThrew);

  // 5. Notifications round-trip on a supported chain (base-sepolia) — proves the path works.
  const throwawayEvm = '0x' + '7'.repeat(40);
  const webhookUrl = 'https://example.com/openx-tatum-smoke';
  let subId: string | null = null;
  try {
    const sub = await client.subscribeAddress(throwawayEvm, webhookUrl, 'base-sepolia');
    subId = sub.id;
    console.log('     base-sepolia subscribe id:', subId);
    ok('LIVE: subscribeAddress (base-sepolia) returned id', !!subId && subId.length > 5);
  } catch (e: any) {
    ok('LIVE: subscribeAddress (base-sepolia)', false, e?.message);
  }
  if (subId) {
    try {
      await client.unsubscribeAddress(subId);
      ok('LIVE: unsubscribeAddress succeeded', true);
    } catch (e: any) {
      ok('LIVE: unsubscribeAddress', false, e?.message);
    }
  }
}

async function run() {
  console.log(LIVE ? '— smoke:tatum LIVE mode —' : '— smoke:tatum DRY mode —');

  // 1. DRY: contract via mock.
  const mock = new MockTatumClient();
  await dryChecks(mock);

  // 2. Real-client key-missing semantics (no network — these throw before fetch).
  await keyMissingChecks();

  // 3. LIVE only: round-trip against Tatum testnet.
  if (LIVE) {
    const live = new TatumClient({
      apiKey: process.env.TATUM_API_KEY,
      suiNetwork: (process.env.SUI_NETWORK as 'testnet' | 'mainnet') ?? 'testnet',
    });
    await liveChecks(live);
  } else {
    console.log('\n  (LIVE checks skipped — set TATUM_API_KEY to run them)\n');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run().catch((e) => {
  console.error('\nsmoke crashed:', e?.message ?? e);
  process.exit(1);
});
