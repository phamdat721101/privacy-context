/**
 * xamanClient — thin wrapper over `xumm-sdk` used by both v3-onboard routes
 * and the auth middleware's XamanVerifier.
 *
 * The Xaman API is our trust anchor for XRPL sign-ins: the frontend never
 * touches the API key/secret, and Xaman itself verifies the signature on
 * their side. Our server-side responsibility is:
 *   • Create a SignIn payload the user can scan/deeplink into Xaman.
 *   • On polling, confirm `meta.signed === true` and read `response.account`.
 *
 * Nonce ↔ uuid mapping is cached in-memory (payloads expire in 15 min so
 * memory pressure is negligible; if we ever run multi-node, promote to a
 * Redis Set — same interface).
 *
 * SOLID:
 *  - SRP: this file owns Xaman API integration + a tiny in-memory cache.
 *  - DIP: exports a `XamanVerifier` implementation that satisfies the
 *    interface declared in onboardTokenService.
 */

import type { XamanVerifier } from './onboardTokenService';
import { logger } from '../lib';

let _cached: XamanRuntime | null = null;
let _cacheChecked = false;

interface XamanRuntime {
  create: (opts: XamanCreateOpts) => Promise<XamanCreated>;
  get: (uuid: string) => Promise<XamanFetched>;
  verifier: XamanVerifier;
  getNonce: (uuid: string) => string | undefined;
}

export interface XamanCreateOpts {
  /** SIWE-canonical message we want the user to acknowledge (memo'd). */
  message: string;
  /** Nonce we'll match against the envelope on verify. */
  nonce: string;
  /** Optional TTL in seconds for the payload (default 900 = 15 min). */
  ttlSec?: number;
}

export interface XamanCreated {
  uuid: string;
  qrLink: string;
  deeplink: string;
  expiresAtSec: number;
}

export interface XamanFetched {
  signed: boolean;
  account?: string;
  expired: boolean;
}

/**
 * Return a Xaman runtime, or null when XUMM_API_KEY/SECRET are unset.
 * Called by routes and middleware; both fail closed with a documented
 * 503 / xaman_unavailable when this is null.
 */
export function getXamanClient(): XamanRuntime | null {
  if (_cacheChecked) return _cached;
  _cacheChecked = true;

  const apiKey = process.env.XUMM_API_KEY;
  const apiSecret = process.env.XUMM_API_SECRET;
  if (!apiKey || !apiSecret) {
    logger.warn({ configured: false }, 'xaman:not-configured');
    return null;
  }

  // Late require — keeps the top-level import graph free of xumm-sdk when
  // the flag is off. Also lets us test the "not configured" branch without
  // installing the dep.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { XummSdk } = require('xumm-sdk') as typeof import('xumm-sdk');
  const xumm = new XummSdk(apiKey, apiSecret);

  const nonceCache = new Map<string, { nonce: string; expiresAtSec: number }>();

  const runtime: XamanRuntime = {
    async create(opts) {
      const ttlSec = opts.ttlSec ?? 15 * 60;
      const expiresAtSec = Math.floor(Date.now() / 1000) + ttlSec;
      // Xaman's SignIn pseudo-tx is a fee-free, non-broadcast proof-of-key
      // signature. We attach the SIWE canonical message as a Memo so the
      // user sees it inside Xaman before approving.
      const payload = await xumm.payload.create({
        txjson: {
          TransactionType: 'SignIn',
          Memos: [
            {
              Memo: {
                MemoData: Buffer.from(opts.message, 'utf8').toString('hex').toUpperCase(),
              },
            },
          ],
        },
        options: { expire: Math.max(1, Math.floor(ttlSec / 60)) },
      });
      if (!payload) throw new Error('xumm:create:null');
      nonceCache.set(payload.uuid, { nonce: opts.nonce, expiresAtSec });
      cleanupExpired(nonceCache);
      return {
        uuid: payload.uuid,
        qrLink: payload.refs?.qr_png ?? '',
        deeplink: payload.next?.always ?? '',
        expiresAtSec,
      };
    },

    async get(uuid) {
      const r = await xumm.payload.get(uuid);
      if (!r) return { signed: false, expired: true };
      return {
        signed: r.meta.signed === true,
        account: r.response.account ?? undefined,
        expired: r.meta.expired === true,
      };
    },

    getNonce(uuid) {
      return nonceCache.get(uuid)?.nonce;
    },

    verifier: {
      async verifySignedPayload(uuid: string) {
        const r = await xumm.payload.get(uuid);
        if (!r || r.meta.signed !== true) return { signed: false };
        return { signed: true, account: r.response.account ?? undefined };
      },
    },
  };

  _cached = runtime;
  return runtime;
}

function cleanupExpired(map: Map<string, { expiresAtSec: number }>): void {
  const nowSec = Math.floor(Date.now() / 1000);
  for (const [k, v] of map) {
    if (v.expiresAtSec < nowSec) map.delete(k);
  }
}
