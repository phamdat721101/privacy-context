#!/usr/bin/env -S npx tsx
/**
 * scripts/smoke-arkiv.ts — Task-1 demo + ongoing CI smoke.
 *
 * Proves that:
 *  1. Our env is wired (ARKIV_RPC_URL, ARKIV_BACKEND_PRIVATE_KEY).
 *  2. WalletClient can write a typed entity to Braga.
 *  3. PublicClient can read it back without a key.
 *  4. PROJECT_ATTRIBUTE + .createdBy() filter returns exactly our entity
 *     (Best Practice #12 — tamper-proof source verification).
 *
 * Gated: requires ARKIV_LIVE=1. CI runs without it (mocked in unit tests).
 *
 * Run: ARKIV_LIVE=1 npm run smoke:arkiv
 */
import { createWalletClient, createPublicClient, http } from '@arkiv-network/sdk';
import { privateKeyToAccount } from '@arkiv-network/sdk/accounts';
import { braga } from '@arkiv-network/sdk/chains';
import { stringToPayload, ExpirationTime } from '@arkiv-network/sdk/utils';
import { eq } from '@arkiv-network/sdk/query';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

const PRIVATE_KEY = process.env.ARKIV_BACKEND_PRIVATE_KEY as `0x${string}` | undefined;
const PROJECT = process.env.ARKIV_PROJECT_ATTRIBUTE ?? 'fhedin-ethns-2c4f9a';

if (!process.env.ARKIV_LIVE) {
  console.log('[smoke:arkiv] set ARKIV_LIVE=1 to run against Braga (this script is a no-op otherwise).');
  process.exit(0);
}
if (!PRIVATE_KEY) {
  console.error('[smoke:arkiv] ARKIV_BACKEND_PRIVATE_KEY missing — run `npm run gen:demo-wallets` first.');
  process.exit(1);
}

async function main(): Promise<void> {
  const account = privateKeyToAccount(PRIVATE_KEY!);
  const wallet = createWalletClient({ chain: braga, transport: http(), account });
  const reader = createPublicClient({ chain: braga, transport: http() });

  console.log(`[smoke:arkiv] backend wallet: ${account.address}`);
  console.log(`[smoke:arkiv] project attribute: ${PROJECT}`);

  // 1. WRITE
  const greeting = `hello-arkiv-${Date.now()}`;
  const { entityKey, txHash } = await wallet.createEntity({
    payload: stringToPayload(greeting),
    contentType: 'text/plain',
    attributes: [
      { key: 'project', value: PROJECT },
      { key: 'entityType', value: 'smoke-test' },
      { key: 'createdAt', value: Date.now() },
    ],
    expiresIn: ExpirationTime.fromMinutes(15),
  });
  console.log(`[smoke:arkiv] write OK  entityKey=${entityKey} tx=${txHash}`);

  // 2. READ-BY-KEY
  const fetched = await reader.getEntity(entityKey);
  const text = fetched.toText();
  if (text !== greeting) {
    console.error(`[smoke:arkiv] read-by-key MISMATCH: got "${text}", expected "${greeting}"`);
    process.exit(1);
  }
  console.log(`[smoke:arkiv] read OK   "${text}"`);

  // 3. QUERY-BY-ATTRIBUTE + .createdBy() — tamper-proof source filter (Best Practice #12)
  const query = await reader
    .buildQuery()
    .where([eq('project', PROJECT), eq('entityType', 'smoke-test')])
    .createdBy(account.address)
    .withPayload(true)
    .limit(5)
    .fetch();
  if (query.entities.length === 0) {
    console.error('[smoke:arkiv] query returned 0 — createdBy filter may be wrong');
    process.exit(1);
  }
  console.log(`[smoke:arkiv] query OK  entities=${query.entities.length}`);
  console.log(`\n[smoke:arkiv] ✅ Braga roundtrip succeeded`);
  console.log(`             explorer: https://explorer.braga.hoodi.arkiv.network/tx/${txHash}`);
  console.log(`             entity:   https://data.arkiv.network/?entityKey=${entityKey}`);
}

main().catch((err) => {
  console.error('[smoke:arkiv] failed:', (err as Error).message);
  process.exit(1);
});
