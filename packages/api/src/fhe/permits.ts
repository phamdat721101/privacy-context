import { ethers } from 'ethers';
import { pool } from '../db';
import { logger } from '../lib';

const VAULT_ABI = [
  'function isAuthorized(address user, address platform) view returns (bool)',
  'function isBrainGranted(uint256 brainId, address platform) view returns (bool)',
];
let _contract: ethers.Contract | null = null;

function getVault() {
  if (!_contract) {
    const rpc = process.env.ARBITRUM_SEPOLIA_RPC || 'https://sepolia-rollup.arbitrum.io/rpc';
    const provider = new ethers.JsonRpcProvider(rpc);
    _contract = new ethers.Contract(process.env.BRAIN_KEY_VAULT_ADDRESS!, VAULT_ABI, provider);
  }
  return _contract;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type PermitReason =
  | 'cache_hit'
  | 'onchain_authorized'
  | 'never_authorized'
  | 'permit_revoked'
  | 'cache_expired'
  | 'config_unavailable'
  | 'rpc_error';

export type VerifyReason =
  | 'parse_failed'
  | 'issuer_mismatch'
  | 'recipient_mismatch'
  | 'contract_mismatch'
  | 'expired'
  | 'sdk_unavailable';

export type ImportRejectReason = VerifyReason | 'onchain_unauthorized' | 'config_unavailable';

export interface PermitStatus { authorized: boolean; reason: PermitReason }

export type VerifyResult =
  | { valid: true; permit: { issuer: string; recipient: string; contract: string; expiration: number } }
  | { valid: false; reason: VerifyReason };

// ─── Verify permit blob (pure validation, no DB) ────────────────────────────

export async function verifyPermit(
  serialized: string,
  expectedIssuer: string,
): Promise<VerifyResult> {
  const platform = process.env.PLATFORM_WALLET?.toLowerCase();
  const contract = process.env.BRAIN_KEY_VAULT_ADDRESS?.toLowerCase();
  if (!platform || !contract) return { valid: false, reason: 'sdk_unavailable' };

  try {
    const { getCofheClient } = await import('./client');
    const cofhe = await getCofheClient();
    const permit = await cofhe.permits.importShared(serialized);

    const issuer = (permit.issuer ?? permit.owner ?? '').toLowerCase();
    const recipient = (permit.recipient ?? permit.allowed ?? platform).toLowerCase();
    const permitContract = (permit.contract ?? permit.contractAddress ?? '').toLowerCase();
    const expiration: number = permit.expiration ?? permit.exp ?? Infinity;

    if (issuer !== expectedIssuer.toLowerCase()) return { valid: false, reason: 'issuer_mismatch' };
    if (recipient !== platform) return { valid: false, reason: 'recipient_mismatch' };
    if (permitContract && permitContract !== contract) return { valid: false, reason: 'contract_mismatch' };
    if (expiration !== Infinity && expiration < Date.now() / 1000) return { valid: false, reason: 'expired' };

    return { valid: true, permit: { issuer, recipient, contract: permitContract || contract, expiration } };
  } catch {
    return { valid: false, reason: 'parse_failed' };
  }
}

// ─── On-chain confirmation ──────────────────────────────────────────────────

export async function confirmOnChain(userAddress: string): Promise<{ authorized: boolean; error?: string }> {
  const platform = process.env.PLATFORM_WALLET;
  if (!platform || !process.env.BRAIN_KEY_VAULT_ADDRESS) return { authorized: false, error: 'config_missing' };
  try {
    const authorized: boolean = await getVault().isAuthorized(
      ethers.getAddress(userAddress),
      ethers.getAddress(platform),
    );
    logger.info({ user: userAddress, authorized }, 'onchain:isAuthorized');
    return { authorized };
  } catch (e: any) {
    logger.warn({ user: userAddress, err: e.message }, 'onchain:isAuthorized:rpc_error');
    return { authorized: false, error: 'rpc_unavailable' };
  }
}

// ─── Per-brain grant check ──────────────────────────────────────────────────

const _brainGrantCache = new Map<string, { authorized: boolean; ts: number }>();

export async function isBrainGranted(brainId: number | string): Promise<boolean> {
  const platform = process.env.PLATFORM_WALLET;
  if (!platform || !process.env.BRAIN_KEY_VAULT_ADDRESS) return false;
  const key = `${brainId}:${platform}`;
  const cached = _brainGrantCache.get(key);
  if (cached && Date.now() - cached.ts < 5 * 60_000) return cached.authorized;
  try {
    const granted: boolean = await getVault().isBrainGranted(BigInt(brainId), ethers.getAddress(platform));
    _brainGrantCache.set(key, { authorized: granted, ts: Date.now() });
    return granted;
  } catch {
    return cached?.authorized ?? false;
  }
}

// ─── Strict import (SDK-verified + on-chain confirmed) ──────────────────────

export async function importPermit(
  userAddress: string,
  serialized: string,
): Promise<{ ok: true; expiresAt: string } | { ok: false; reason: ImportRejectReason }> {
  const verify = await verifyPermit(serialized, userAddress);
  if (verify.valid === false) return { ok: false, reason: verify.reason };

  const onchain = await confirmOnChain(userAddress);
  if (!onchain.authorized) return { ok: false, reason: onchain.error === 'config_missing' ? 'config_unavailable' : 'onchain_unauthorized' };

  const addr = userAddress.toLowerCase();
  const expiresAt = new Date(Date.now() + 3600_000).toISOString(); // 1h flat TTL
  await pool.query(
    `INSERT INTO permits (user_address, serialized_permit, recipient, expires_at, permit_kind)
     VALUES ($1, $2, $3, $4, 'sdk')
     ON CONFLICT (user_address) DO UPDATE SET serialized_permit = $2, recipient = $3, expires_at = $4, permit_kind = 'sdk', created_at = NOW()`,
    [addr, serialized.slice(0, 200), verify.permit.recipient, expiresAt],
  );
  logger.info({ user: addr }, 'permit:imported:sdk');
  return { ok: true, expiresAt };
}

// ─── Revoke ─────────────────────────────────────────────────────────────────

export async function revokePermit(userAddress: string): Promise<void> {
  await pool.query(`DELETE FROM permits WHERE user_address = $1`, [userAddress.toLowerCase()]);
}

// ─── Cache-based check (perf only — security enforced at insert) ────────────

export async function hasPermit(
  userAddress: string,
  opts: { forceRefresh?: boolean } = {},
): Promise<PermitStatus> {
  const addr = userAddress.toLowerCase();

  if (!opts.forceRefresh) {
    const { rows } = await pool.query(
      `SELECT 1 FROM permits WHERE user_address = $1 AND created_at > NOW() - INTERVAL '1 hour' LIMIT 1`,
      [addr],
    );
    if (rows.length > 0) return { authorized: true, reason: 'cache_hit' };
  }

  const onchain = await confirmOnChain(userAddress);
  if (onchain.error === 'config_missing') return { authorized: false, reason: 'config_unavailable' };
  if (onchain.error) return { authorized: false, reason: 'rpc_error' };

  if (onchain.authorized) {
    await pool.query(
      `INSERT INTO permits (user_address, serialized_permit, permit_kind)
       VALUES ($1, 'on-chain-refresh', 'sdk')
       ON CONFLICT (user_address) DO UPDATE SET created_at = NOW()`,
      [addr],
    );
    return { authorized: true, reason: 'onchain_authorized' };
  }

  // On-chain says no — if we had a stale cache row, delete it.
  await pool.query(`DELETE FROM permits WHERE user_address = $1`, [addr]);
  return { authorized: false, reason: opts.forceRefresh ? 'permit_revoked' : 'never_authorized' };
}
