/**
 * v3-onboard — identity + onboard-token flow.
 *
 * Endpoints (all under /v3):
 *   GET  /onboard/nonce            — public — issue a SIWE-compatible nonce
 *   POST /onboard/xaman/create     — public — start a Xaman sign-in payload
 *   GET  /onboard/xaman/:uuid      — public — poll a Xaman payload
 *   GET  /user/me                  — authed — return {user_id, wallets, chain}
 *   POST /user/link-wallet         — authed — attach a second verified wallet
 *
 * The router is mounted at /v3 in server.ts. Public endpoints are
 * whitelisted in middleware/auth.ts (`/onboard/*`); authed endpoints
 * receive `req.user.address` set by the auth middleware after it verifies
 * the `x-openx-token` envelope via onboardTokenService.
 *
 * SOLID:
 *  - SRP: routes only. Token verify lives in services/onboardTokenService;
 *    Xaman API access is encapsulated in a small local helper.
 *  - DIP: xumm client is lazily constructed from env; when the env is
 *    missing, /xaman/* routes fail closed with a documented 503.
 */

import { Router, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import { pool } from '../db';
import { logger } from '../lib';
import type { AuthRequest } from '../middleware/auth';
import { verifyOnboardToken, decodeEnvelope } from '../services/onboardTokenService';

const router = Router();

// ─── Public: nonce issuance ─────────────────────────────────────────────

const NONCE_TTL_SEC = 15 * 60;

/**
 * Generate an alphanumeric nonce ≥ 8 chars (siwe requirement). We use
 * base32-ish hex with padding to keep the alphabet regex-compatible.
 */
function generateNonce(): string {
  return randomBytes(16).toString('hex'); // 32 alphanumeric hex chars
}

router.get('/onboard/nonce', (_req: Request, res: Response) => {
  const nonce = generateNonce();
  const issuedAtSec = Math.floor(Date.now() / 1000);
  res.json({
    nonce,
    issuedAtSec,
    expiresAtSec: issuedAtSec + NONCE_TTL_SEC,
  });
});

// ─── Xaman OAuth2-style flow ────────────────────────────────────────────
//
// Server-mediated because Xaman's SDK requires an API key/secret. The
// resulting envelope carries `xaman_uuid` and empty signature/publicKey —
// verifyOnboardToken() re-hits Xaman via the injected XamanVerifier to
// confirm `meta.signed && account.matches(env.address)`.

import { getXamanClient } from '../services/xamanClient';

const DEFAULT_STATEMENT = 'Enable this device to publish agents on OpenX.';

/**
 * XRPL SIWE-shaped canonical message. Mirrors sdk/permits/createPermit.ts
 * `buildOnboardMessage({ chain: 'xrpl', … })`. Duplicated here (one small
 * function, one location) so the api package doesn't take a workspace dep
 * on the SDK just for a text template.
 */
function buildXrplOnboardMessage(opts: {
  domain: string;
  uri: string;
  nonce: string;
  address?: string;
  statement?: string;
  expiresAtSec?: number;
}): string {
  const issuedAt = new Date();
  const expSec = opts.expiresAtSec ?? Math.floor(issuedAt.getTime() / 1000) + 15 * 60;
  const expirationTime = new Date(expSec * 1000).toISOString();
  return [
    `${opts.domain} wants you to sign in with your XRPL account:`,
    opts.address ?? '<XRPL address will appear here after you sign>',
    '',
    opts.statement ?? DEFAULT_STATEMENT,
    '',
    `URI: ${opts.uri}`,
    `Version: 1`,
    `Chain: XRPL`,
    `Nonce: ${opts.nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${expirationTime}`,
  ].join('\n');
}

router.post('/onboard/xaman/create', async (req: Request, res: Response) => {
  const xaman = getXamanClient();
  if (!xaman) return res.status(503).json({ error: 'xaman_not_configured' });

  const nonce = (req.body?.nonce as string) || generateNonce();
  // The address is unknown at create-time — user picks it in Xaman. We build
  // a message template with a placeholder that the frontend re-fetches after
  // signing (once the account is known).
  const domain = process.env.SIWE_DOMAIN ?? req.hostname;
  const uri = `${req.protocol}://${req.get('host') ?? domain}`;
  const template = buildXrplOnboardMessage({ domain, uri, nonce });

  try {
    const created = await xaman.create({ message: template, nonce });
    res.json({
      uuid: created.uuid,
      qr: created.qrLink,
      deeplink: created.deeplink,
      nonce,
      expiresAtSec: created.expiresAtSec,
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'v3:onboard:xaman:create:error');
    res.status(502).json({ error: 'xaman_upstream_error' });
  }
});

router.get('/onboard/xaman/:uuid', async (req: Request, res: Response) => {
  const xaman = getXamanClient();
  if (!xaman) return res.status(503).json({ error: 'xaman_not_configured' });

  const uuid = String(req.params.uuid ?? '');
  const nonce = xaman.getNonce(uuid);
  if (!nonce) return res.status(404).json({ error: 'unknown_uuid_or_expired' });

  try {
    const result = await xaman.get(uuid);
    if (result.expired && !result.signed) return res.json({ signed: false, expired: true });
    if (!result.signed) return res.json({ signed: false });
    if (!result.account) return res.status(502).json({ error: 'xaman_missing_account' });

    const domain = process.env.SIWE_DOMAIN ?? req.hostname;
    const uri = `${req.protocol}://${req.get('host') ?? domain}`;
    const message = buildXrplOnboardMessage({ domain, uri, nonce, address: result.account });
    const envelope = {
      v: 1 as const,
      chain: 'xrpl' as const,
      address: result.account,
      message,
      signature: '',
      publicKey: '',
      xaman_uuid: uuid,
    };
    res.json({ signed: true, envelope });
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'v3:onboard:xaman:poll:error');
    res.status(502).json({ error: 'xaman_upstream_error' });
  }
});

// ─── Authed: identity read ──────────────────────────────────────────────

/**
 * Idempotent upsert — auth middleware calls this on every verified onboard
 * token so the very first sign-in materializes the user row. Multiple
 * wallets on the same user_id share the row through linked_wallets.
 *
 * On first-seen (chain, address) with no matching user_id, we create a new
 * user_id (uuid). The caller can then attach more wallets via link-wallet.
 */
export async function upsertLinkedWallet(chain: 'evm' | 'xrpl', address: string): Promise<{ user_id: string }> {
  const now = new Date().toISOString();
  const existing = await pool.query(
    `SELECT user_id FROM linked_wallets WHERE chain = $1 AND address = $2 LIMIT 1`,
    [chain, address],
  );
  if ((existing.rowCount ?? 0) > 0) {
    await pool.query(
      `UPDATE linked_wallets SET last_seen_at = $3 WHERE chain = $1 AND address = $2`,
      [chain, address, now],
    );
    return { user_id: existing.rows[0].user_id };
  }
  const insert = await pool.query(
    `INSERT INTO linked_wallets (chain, address, user_id, is_payout, last_seen_at)
     VALUES ($1, $2, gen_random_uuid(), TRUE, $3)
     RETURNING user_id`,
    [chain, address, now],
  );
  return { user_id: insert.rows[0].user_id };
}

router.get('/user/me', async (req: AuthRequest, res: Response) => {
  if (!req.user?.address) return res.status(401).json({ error: 'auth_required' });
  const primaryAddress = req.user.address;
  const primaryChain = (req.user as any).chain ?? 'evm';

  try {
    const { user_id } = await upsertLinkedWallet(primaryChain, primaryAddress);
    const wallets = await pool.query(
      `SELECT chain, address, is_payout, linked_at, last_seen_at
       FROM linked_wallets WHERE user_id = $1 ORDER BY linked_at ASC`,
      [user_id],
    );
    res.json({
      user_id,
      address: primaryAddress,
      chain: primaryChain,
      wallets: wallets.rows,
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'v3:user:me:error');
    res.status(500).json({ error: 'internal_error' });
  }
});

// ─── Authed: link another wallet ────────────────────────────────────────
//
// Accepts a second onboard envelope in the request body; verifies it, and
// attaches its address to the current user_id. The two wallets must not
// already be attached to different user_ids.

router.post('/user/link-wallet', async (req: AuthRequest, res: Response) => {
  if (!req.user?.address) return res.status(401).json({ error: 'auth_required' });
  const primaryAddress = req.user.address;
  const primaryChain = ((req.user as any).chain ?? 'evm') as 'evm' | 'xrpl';

  const secondaryEnvelope = decodeEnvelope(req.body?.envelope);
  if (!secondaryEnvelope) return res.status(400).json({ error: 'envelope_malformed' });

  const verified = await verifyOnboardToken(secondaryEnvelope, {
    expectedDomain: process.env.SIWE_DOMAIN,
  });
  if (!verified.ok) {
    const reason = 'reason' in verified ? verified.reason : 'unknown';
    return res.status(400).json({ error: 'link_verify_failed', reason });
  }

  try {
    const primary = await upsertLinkedWallet(primaryChain, primaryAddress);
    const conflict = await pool.query(
      `SELECT user_id FROM linked_wallets WHERE chain = $1 AND address = $2 LIMIT 1`,
      [verified.token.chain, verified.token.address],
    );
    if ((conflict.rowCount ?? 0) > 0 && conflict.rows[0].user_id !== primary.user_id) {
      return res.status(409).json({ error: 'wallet_owned_by_another_user' });
    }
    await pool.query(
      `INSERT INTO linked_wallets (chain, address, user_id, is_payout, last_seen_at)
       VALUES ($1, $2, $3, FALSE, NOW())
       ON CONFLICT (chain, address) DO UPDATE SET user_id = $3, last_seen_at = NOW()`,
      [verified.token.chain, verified.token.address, primary.user_id],
    );
    res.json({ ok: true, user_id: primary.user_id });
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'v3:user:link-wallet:error');
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
