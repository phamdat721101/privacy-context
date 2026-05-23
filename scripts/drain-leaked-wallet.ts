#!/usr/bin/env -S npx tsx
/**
 * scripts/drain-leaked-wallet.ts — one-shot consolidation of test funds.
 *
 * The previously-disclosed key (see docs/SECURITY.md) is decommissioned.
 * This script reads it ONCE from the LEGACY_DECOMM_PRIVATE_KEY env var
 * (which is NOT committed and NOT in .env.local), drains its balances on
 * every supported testnet to the fresh demo wallets, and exits. The leaked
 * key MUST NOT be reused for any deployed component thereafter.
 *
 * Chains drained:
 *   - Braga (Arkiv testnet)        : GLM   → ARKIV_BACKEND_WALLET
 *   - Arbitrum Sepolia              : ETH   → ARKIV_BACKEND_WALLET
 *   - Base Sepolia                  : ETH   → DEMO_BUYER_WALLET
 *   - Base Sepolia (USDC ERC-20)    : USDC  → DEMO_BUYER_WALLET
 *
 * Run (one-shot, key passed via env so it never lands in any file):
 *   LEGACY_DECOMM_PRIVATE_KEY=0x… npm run drain:leaked
 *
 * After completion the leaked key is to be considered burned. The fresh
 * wallets in .env.local are the only authoritative dev keys going forward.
 */
import { createPublicClient, createWalletClient, http, parseEther, encodeFunctionData, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia, baseSepolia } from 'viem/chains';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

const LEGACY = process.env.LEGACY_DECOMM_PRIVATE_KEY as `0x${string}` | undefined;
const BACKEND = (process.env.ARKIV_BACKEND_WALLET ?? '').toLowerCase() as Hex;
const BUYER   = (process.env.DEMO_BUYER_WALLET    ?? '').toLowerCase() as Hex;

if (!LEGACY) {
  console.error('[drain] pass the decommissioned key as LEGACY_DECOMM_PRIVATE_KEY=0x… (one-shot env var, never committed).');
  console.error('         then run:  LEGACY_DECOMM_PRIVATE_KEY=0x… npm run drain:leaked');
  process.exit(1);
}
if (!/^0x[0-9a-f]{40}$/.test(BACKEND) || !/^0x[0-9a-f]{40}$/.test(BUYER)) {
  console.error('[drain] ARKIV_BACKEND_WALLET / DEMO_BUYER_WALLET missing. Run `npm run gen:demo-wallets` first.');
  process.exit(1);
}

// Braga chain config — minimal viem-shaped object (avoids @arkiv-network/sdk/chains here).
const braga = {
  id: 60138453102,
  name: 'Arkiv Braga',
  nativeCurrency: { name: 'Golem', symbol: 'GLM', decimals: 18 },
  rpcUrls: { default: { http: ['https://braga.hoodi.arkiv.network/rpc'] } },
  blockExplorers: { default: { name: 'Arkiv-Braga', url: 'https://explorer.braga.hoodi.arkiv.network' } },
} as const;

// Circle's official Base Sepolia USDC — verified at https://developers.circle.com/stablecoins/docs/usdc-on-test-networks
const USDC_BASE_SEPOLIA: Hex = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const ERC20_TRANSFER_ABI = [{ type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] }] as const;
const ERC20_BALANCE_ABI  = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }] as const;

const account = privateKeyToAccount(LEGACY);

// Public-address-only logging — never the secret.
console.log(`[drain] sweeping from   ${account.address}`);
console.log(`[drain] backend target  ${BACKEND}`);
console.log(`[drain] buyer target    ${BUYER}\n`);

const GAS_BUFFER_NATIVE = parseEther('0.001'); // leave 0.001 of gas for the drain tx itself

async function drainNative(label: string, chain: any, target: Hex): Promise<void> {
  const pub = createPublicClient({ chain, transport: http() });
  const wal = createWalletClient({ chain, transport: http(), account }) as any;
  let bal: bigint;
  try { bal = await pub.getBalance({ address: account.address }); }
  catch (e) { console.log(`[drain] ${label.padEnd(20)} skip · rpc unreachable (${(e as Error).message})`); return; }

  if (bal <= GAS_BUFFER_NATIVE) {
    console.log(`[drain] ${label.padEnd(20)} skip · balance ${bal.toString()} wei (≤ buffer)`);
    return;
  }
  const send = bal - GAS_BUFFER_NATIVE;
  try {
    const hash = await wal.sendTransaction({ to: target, value: send });
    console.log(`[drain] ${label.padEnd(20)} ok   · ${(Number(send) / 1e18).toFixed(6)} → ${target.slice(0, 10)}…  tx=${hash}`);
  } catch (e) {
    console.log(`[drain] ${label.padEnd(20)} fail · ${(e as Error).message.split('\n')[0]}`);
  }
}

async function drainErc20(label: string, chain: any, token: Hex, target: Hex): Promise<void> {
  const pub = createPublicClient({ chain, transport: http() }) as any;
  const wal = createWalletClient({ chain, transport: http(), account }) as any;
  let bal: bigint;
  try {
    bal = await pub.readContract({ address: token, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [account.address] });
  } catch (e) { console.log(`[drain] ${label.padEnd(20)} skip · token rpc fail (${(e as Error).message})`); return; }
  if (bal === 0n) { console.log(`[drain] ${label.padEnd(20)} skip · 0 token balance`); return; }
  try {
    const hash = await wal.sendTransaction({
      to: token,
      data: encodeFunctionData({ abi: ERC20_TRANSFER_ABI, functionName: 'transfer', args: [target, bal] }),
    });
    console.log(`[drain] ${label.padEnd(20)} ok   · ${(Number(bal) / 1e6).toFixed(6)} → ${target.slice(0, 10)}…  tx=${hash}`);
  } catch (e) {
    console.log(`[drain] ${label.padEnd(20)} fail · ${(e as Error).message.split('\n')[0]}`);
  }
}

async function main(): Promise<void> {
  await drainNative('GLM (Braga)',         braga,           BACKEND);
  await drainNative('ETH (Arb Sepolia)',   arbitrumSepolia, BACKEND);
  await drainNative('ETH (Base Sepolia)',  baseSepolia,     BUYER);
  await drainErc20 ('USDC (Base Sepolia)', baseSepolia, USDC_BASE_SEPOLIA, BUYER);
  console.log('\n[drain] done. Treat the legacy key as burned — it must never be re-used.');
  console.log('[drain] policy: docs/SECURITY.md > Decommissioned keys.');
}

main().catch((err) => { console.error('[drain] failed:', (err as Error).message); process.exit(1); });
