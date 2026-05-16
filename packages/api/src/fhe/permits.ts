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

export async function importPermit(userAddress: string, txHash: string): Promise<void> {
  // Cache the on-chain authorization tx in DB for fast lookups
  await pool.query(
    `INSERT INTO permits (user_address, serialized_permit) VALUES ($1, $2)
     ON CONFLICT (user_address) DO UPDATE SET serialized_permit = $2, created_at = NOW()`,
    [userAddress.toLowerCase(), txHash]
  );
}

export async function revokePermit(userAddress: string): Promise<void> {
  await pool.query(`DELETE FROM permits WHERE user_address = $1`, [userAddress.toLowerCase()]);
}

export async function hasPermit(userAddress: string): Promise<boolean> {
  // Fast path: DB cache (1 hour TTL)
  const { rows } = await pool.query(
    `SELECT 1 FROM permits WHERE user_address = $1 AND created_at > NOW() - INTERVAL '1 hour' LIMIT 1`,
    [userAddress.toLowerCase()]
  );
  if (rows.length > 0) return true;

  // Slow path: read on-chain
  try {
    const platform = process.env.PLATFORM_WALLET;
    if (!platform || !process.env.BRAIN_KEY_VAULT_ADDRESS) return false;
    const authorized: boolean = await getVault().isAuthorized(
      ethers.getAddress(userAddress),
      ethers.getAddress(platform)
    );
    if (authorized) {
      await pool.query(
        `INSERT INTO permits (user_address, serialized_permit) VALUES ($1, 'on-chain')
         ON CONFLICT (user_address) DO UPDATE SET created_at = NOW()`,
        [userAddress.toLowerCase()]
      );
    }
    return authorized;
  } catch { return false; }
}
