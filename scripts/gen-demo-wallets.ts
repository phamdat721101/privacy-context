#!/usr/bin/env -S npx tsx
/**
 * scripts/gen-demo-wallets.ts — fresh-wallet generator for the Arkiv demo.
 *
 * Why this exists: a previous test private key was disclosed in plaintext
 * in chat. It is decommissioned (see docs/SECURITY.md). This script mints
 * three fresh, scope-limited wallets:
 *
 *   - ARKIV_BACKEND  : pays GLM gas on Braga; owns every memory entity.
 *   - MEMORY_AGENT   : signs LearnedFact payloads (signature-recovery proof).
 *   - DEMO_BUYER     : the buyer in scripts/demo-arkiv-memory-market.ts.
 *
 * Output: appends/updates .env.local (chmod 600). NEVER prints private keys
 * to stdout — only public addresses and a fund-me hint. Idempotent: re-running
 * preserves existing values unless --force is passed.
 *
 * Run: npm run gen:demo-wallets
 *      npm run gen:demo-wallets -- --force   (overwrite)
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const ENV_PATH = join(process.cwd(), '.env.local');
const FORCE = process.argv.includes('--force');

const KEYS = [
  ['ARKIV_BACKEND_PRIVATE_KEY', 'ARKIV_BACKEND_WALLET'],
  ['MEMORY_AGENT_PRIVATE_KEY', 'MEMORY_AGENT_WALLET'],
  ['DEMO_BUYER_PRIVATE_KEY', 'DEMO_BUYER_WALLET'],
] as const;

async function main(): Promise<void> {
  const existing = await readDotenv(ENV_PATH);
  const out: Record<string, string> = { ...existing };
  let created = 0;

  for (const [skKey, addrKey] of KEYS) {
    if (!FORCE && existing[skKey] && existing[addrKey]) continue;
    const sk = generatePrivateKey();
    const acct = privateKeyToAccount(sk);
    out[skKey] = sk;
    out[addrKey] = acct.address;
    out[`NEXT_PUBLIC_${addrKey}`] = acct.address;
    created += 1;
    // PUBLIC ADDRESS ONLY — never log the secret.
    console.log(`[wallet] ${addrKey}=${acct.address}`);
  }

  if (created === 0) {
    console.log('[wallet] all 3 wallets already provisioned in .env.local — pass --force to regenerate.');
    return;
  }
  await writeDotenv(ENV_PATH, out);
  await fs.chmod(ENV_PATH, 0o600).catch(() => undefined);
  console.log(`\n[wallet] wrote ${created} fresh wallets to ${ENV_PATH} (chmod 600)`);
  console.log('[wallet] fund the addresses above:');
  console.log('         GLM  (Braga, gas)        → https://braga.hoodi.arkiv.network/faucet/');
  console.log('         ETH  (Arbitrum Sepolia)  → https://sepolia-faucet.arbitrum.io/');
  console.log('         USDC (Base Sepolia)      → https://faucet.circle.com/');
}

async function readDotenv(p: string): Promise<Record<string, string>> {
  try {
    const txt = await fs.readFile(p, 'utf8');
    const map: Record<string, string> = {};
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) map[m[1]] = m[2];
    }
    return map;
  } catch {
    return {};
  }
}

async function writeDotenv(p: string, map: Record<string, string>): Promise<void> {
  const lines = Object.entries(map).map(([k, v]) => `${k}=${v}`);
  await fs.writeFile(p, lines.join('\n') + '\n', { mode: 0o600 });
}

main().catch((err) => {
  console.error('[wallet] failed:', (err as Error).message);
  process.exit(1);
});
