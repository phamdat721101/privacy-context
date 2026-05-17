import { ethers } from 'ethers';
import { pool } from '../db';

const VAULT_ABI = ['function isAuthorized(address user, address platform) view returns (bool)'];
let _contract: ethers.Contract | null = null;

function getVault() {
  if (!_contract) {
    const rpc = process.env.ARBITRUM_SEPOLIA_RPC || 'https://sepolia-rollup.arbitrum.io/rpc';
    const provider = new ethers.JsonRpcProvider(rpc);
    _contract = new ethers.Contract(process.env.BRAIN_KEY_VAULT_ADDRESS!, VAULT_ABI, provider);
  }
  return _contract;
}

/**
 * Reason codes for why a permit check resolved the way it did. Surfaced to
 * the frontend via /permit/status and 403 bodies so the UI can guide the
 * user into the right recovery action without guessing.
 */
export type PermitReason =
  | 'cache_hit'             // DB cache row found and not expired
  | 'onchain_authorized'    // bypass-cache check confirmed authorization on-chain
  | 'never_authorized'      // on-chain check ran and returned false
  | 'cache_expired'         // DB row expired and on-chain check could not be performed
  | 'config_unavailable'    // server missing PLATFORM_WALLET / BRAIN_KEY_VAULT_ADDRESS
  | 'rpc_error';            // on-chain RPC call threw

export interface PermitStatus {
  authorized: boolean;
  reason: PermitReason;
}

export async function importPermit(userAddress: string, txHash: string): Promise<void> {
  await pool.query(
    `INSERT INTO permits (user_address, serialized_permit) VALUES ($1, $2)
     ON CONFLICT (user_address) DO UPDATE SET serialized_permit = $2, created_at = NOW()`,
    [userAddress.toLowerCase(), txHash]
  );
}

export async function revokePermit(userAddress: string): Promise<void> {
  await pool.query(`DELETE FROM permits WHERE user_address = $1`, [userAddress.toLowerCase()]);
}

/**
 * Check whether a user has authorized the platform.
 *
 * @param opts.forceRefresh — bypass DB cache and re-check on-chain. Used by
 *        permitGate as a self-heal on cache miss before returning 403.
 */
export async function hasPermit(
  userAddress: string,
  opts: { forceRefresh?: boolean } = {},
): Promise<PermitStatus> {
  const addr = userAddress.toLowerCase();

  // Fast path: DB cache (1 hour TTL), unless caller asks to bypass.
  if (!opts.forceRefresh) {
    const { rows } = await pool.query(
      `SELECT 1 FROM permits WHERE user_address = $1 AND created_at > NOW() - INTERVAL '1 hour' LIMIT 1`,
      [addr]
    );
    if (rows.length > 0) return { authorized: true, reason: 'cache_hit' };
  }

  // Slow path: read on-chain.
  const platform = process.env.PLATFORM_WALLET;
  if (!platform || !process.env.BRAIN_KEY_VAULT_ADDRESS) {
    return { authorized: false, reason: 'config_unavailable' };
  }

  try {
    const onchain: boolean = await getVault().isAuthorized(
      ethers.getAddress(userAddress),
      ethers.getAddress(platform)
    );
    if (onchain) {
      // Refresh cache so the next call is fast.
      await pool.query(
        `INSERT INTO permits (user_address, serialized_permit) VALUES ($1, 'on-chain')
         ON CONFLICT (user_address) DO UPDATE SET created_at = NOW()`,
        [addr]
      );
      return { authorized: true, reason: 'onchain_authorized' };
    }
    return { authorized: false, reason: opts.forceRefresh ? 'never_authorized' : 'cache_expired' };
  } catch {
    return { authorized: false, reason: 'rpc_error' };
  }
}
