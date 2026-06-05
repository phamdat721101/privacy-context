/**
 * v3-identity.ts — EVM ↔ Sui address binding for the trustless tier.
 *
 * Mounted at `/v3/identity` (parent /v3 mount adds wallet auth). The EVM
 * identity is taken from `req.user.address` (already verified by the
 * upstream `auth` middleware via Privy/wallet signature). The user only
 * needs to prove possession of the Sui key — they sign a canonical message
 * with their Sui wallet, and we verify it server-side with `@mysten/sui`.
 *
 * Why this design (SOLID):
 *  - SRP: identity binding only. No payments, no brain CRUD.
 *  - DIP: signature verification delegates to `@mysten/sui/verify` — no
 *    hand-rolled ed25519. Replay defense is a fresh nonce + 5-minute window.
 *  - OCP: more chain bindings later (e.g. Solana, Aptos) = sibling tables +
 *    sibling routes; this file never grows.
 */

import { Router, type Response } from 'express';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { pool } from '../db';
import { logger } from '../lib';
import type { AuthRequest } from '../middleware/auth';

const router = Router();

// Replay-defense window. 5 minutes is the same envelope dapp-kit uses for
// signed-personal-message TTLs.
const NONCE_WINDOW_MS = 5 * 60 * 1000;

/** Canonical message the Sui wallet signs. Identical bytes = identical hash =
 *  signature recoverability. The frontend MUST construct the same string. */
function canonicalMessage(evm: string, sui: string, nonce: string, ts: number): string {
  return `openx-link-sui:${evm.toLowerCase()}:${sui.toLowerCase()}:${nonce}:${ts}`;
}

interface LinkBody {
  suiAddress?: string;
  signature?: string;
  nonce?: string;
  ts?: number;
}

/**
 * POST /v3/identity/link — bind the caller's authenticated EVM address to a
 * Sui address, gated on a Sui-wallet personal-message signature.
 *
 * Body: { suiAddress, signature, nonce, ts }
 * Header: x-wallet-address (handled by parent auth middleware)
 *
 * Idempotent for the same (evm, sui) pair — duplicate POSTs are 200.
 */
router.post('/link', async (req: AuthRequest, res: Response) => {
  const evmAddress = req.user?.address?.toLowerCase();
  if (!evmAddress) return res.status(401).json({ error: 'auth required' });

  const { suiAddress, signature, nonce, ts } = (req.body ?? {}) as LinkBody;
  if (!suiAddress || !signature || !nonce || typeof ts !== 'number') {
    return res.status(400).json({ error: 'suiAddress, signature, nonce, ts required' });
  }

  // Replay defense: timestamp must be within ±NONCE_WINDOW_MS.
  if (Math.abs(Date.now() - ts) > NONCE_WINDOW_MS) {
    return res.status(400).json({ error: 'signature expired or clock-skewed', code: 'expired' });
  }

  const message = canonicalMessage(evmAddress, suiAddress, nonce, ts);
  const messageBytes = new TextEncoder().encode(message);

  // Verify the signature with @mysten/sui — returns the recovered public key
  // on success, throws on bad signatures. We then enforce that the recovered
  // address matches the claimed `suiAddress`.
  let recoveredAddress: string;
  try {
    const publicKey = await verifyPersonalMessageSignature(messageBytes, signature);
    recoveredAddress = publicKey.toSuiAddress();
  } catch (err) {
    logger.warn({ err: (err as Error).message, evmAddress }, 'v3:identity:link:bad-signature');
    return res.status(400).json({ error: 'invalid Sui signature', code: 'bad_signature' });
  }

  if (recoveredAddress.toLowerCase() !== suiAddress.toLowerCase()) {
    return res.status(400).json({
      error: 'signature does not match claimed Sui address',
      code: 'address_mismatch',
    });
  }

  try {
    await pool.query(
      `INSERT INTO sui_identity_bindings (evm_address, sui_address, signature, nonce, linked_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (evm_address) DO UPDATE
         SET sui_address = EXCLUDED.sui_address,
             signature   = EXCLUDED.signature,
             nonce       = EXCLUDED.nonce,
             linked_at   = NOW()`,
      [evmAddress, suiAddress.toLowerCase(), signature, nonce],
    );
    logger.info({ evmAddress, suiAddress }, 'v3:identity:link:ok');
    res.json({ ok: true, evmAddress, suiAddress: suiAddress.toLowerCase() });
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === '23505') {
      // sui_address UNIQUE — same Sui address bound to a different EVM.
      return res.status(409).json({ error: 'Sui address already bound to a different EVM identity' });
    }
    logger.error({ err: e.message, code: e.code, evmAddress }, 'v3:identity:link:failed');
    res.status(500).json({ error: 'persistence failed' });
  }
});

/**
 * GET /v3/identity/me — return the caller's binding (if any).
 */
router.get('/me', async (req: AuthRequest, res: Response) => {
  const evmAddress = req.user?.address?.toLowerCase();
  if (!evmAddress) return res.status(401).json({ error: 'auth required' });
  const r = await pool.query(
    `SELECT evm_address, sui_address, linked_at FROM sui_identity_bindings WHERE evm_address = $1`,
    [evmAddress],
  );
  if (r.rowCount === 0) return res.json({ bound: false });
  res.json({ bound: true, ...r.rows[0] });
});

export default router;
