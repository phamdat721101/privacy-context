/**
 * onboardTokenService — verify chain-agnostic onboard tokens.
 *
 * Envelope is a base64url-encoded JSON blob carried in `x-openx-token`.
 * The auth middleware calls `verifyOnboardToken()` and receives a normalized
 * identity; downstream consumers treat the returned shape the same
 * regardless of chain.
 *
 * SOLID:
 *  - SRP: this module verifies bearer tokens only. No DB, no nonce issuance
 *    (see routes/v3-onboard.ts), no jti-spent tracking (see
 *    fhe/permits.consumeOnboardJti — reused as-is).
 *  - Open/Closed: adding a chain = one new `verifyX()` helper + one branch
 *    in `verifyOnboardToken()`. No consumer changes.
 *  - DIP: EVM signature verification comes from `siwe`; XRPL verification
 *    comes from `ripple-keypairs` (native) or an injected `xamanVerifier`
 *    (server-mediated). This file does no manual signature math.
 */

import { SiweMessage } from 'siwe';
import { verify as rippleVerify, deriveAddress } from 'ripple-keypairs';

export type OnboardChain = 'evm' | 'xrpl';

/** Envelope shape carried on the wire (before base64url + JSON). */
export interface OnboardEnvelope {
  v: 1;
  chain: OnboardChain;
  /** Account address — 0x… (EVM) or r… (XRPL). */
  address: string;
  /** SIWE-canonical message actually shown to the user. */
  message: string;
  /** Hex signature. 0x-prefixed for EVM; bare hex for native XRPL; empty when Xaman-attested. */
  signature: string;
  /** Compressed pubkey hex (XRPL only; empty when Xaman-attested). */
  publicKey?: string;
  /** Set when the envelope was issued via the Xaman server-mediated flow.
   *  The server re-verifies by calling Xaman's API — the signature field is
   *  unused in that branch. */
  xaman_uuid?: string;
}

export interface VerifiedOnboardToken {
  chain: OnboardChain;
  /** Normalized address — lowercased for EVM; unchanged for XRPL. */
  address: string;
  /** Nonce parsed from the message; reused as the single-use jti. */
  jti: string;
  /** Expiration epoch seconds. */
  expiresAtSec: number;
}

export type VerifyRejectReason =
  | 'envelope_malformed'
  | 'chain_unsupported'
  | 'signature_invalid'
  | 'address_mismatch'
  | 'nonce_missing'
  | 'expired'
  | 'domain_mismatch'
  | 'xaman_unavailable'
  | 'xaman_not_signed';

export type VerifyResult =
  | { ok: true; token: VerifiedOnboardToken }
  | { ok: false; reason: VerifyRejectReason };

/** Injection point for the Xaman server-mediated verify. Kept out of this
 *  module so it stays free of network I/O (SRP). Provided by routes/v3-onboard. */
export interface XamanVerifier {
  /** Look up a Xaman payload by uuid; return signed=true + account when finalized. */
  verifySignedPayload(uuid: string): Promise<{ signed: boolean; account?: string } | null>;
}

export interface VerifyOptions {
  expectedDomain?: string;
  xaman?: XamanVerifier;
}

const nowSec = (): number => Math.floor(Date.now() / 1000);

// ─── Wire codec ─────────────────────────────────────────────────────────

/** Decode `x-openx-token` header → envelope. Accepts base64url(JSON) or raw JSON. */
export function decodeEnvelope(header: string | undefined | null): OnboardEnvelope | null {
  if (!header) return null;
  const raw = header.trim();
  const attempts = [raw];
  try { attempts.push(Buffer.from(raw, 'base64url').toString('utf8')); } catch { /* raw already tried */ }
  for (const s of attempts) {
    try {
      const obj = JSON.parse(s);
      if (obj && obj.v === 1 && (obj.chain === 'evm' || obj.chain === 'xrpl')) {
        return obj as OnboardEnvelope;
      }
    } catch { /* try next */ }
  }
  return null;
}

/** Convenience: envelope → wire (base64url of JSON). */
export function encodeEnvelope(env: OnboardEnvelope): string {
  return Buffer.from(JSON.stringify(env), 'utf8').toString('base64url');
}

// ─── Public entry ───────────────────────────────────────────────────────

export async function verifyOnboardToken(
  envelope: OnboardEnvelope,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  if (!envelope || envelope.v !== 1) return { ok: false, reason: 'envelope_malformed' };
  if (envelope.chain === 'evm') return verifyEvm(envelope, opts.expectedDomain);
  if (envelope.chain === 'xrpl') {
    if (envelope.xaman_uuid) return verifyXaman(envelope, opts);
    return verifyXrplNative(envelope, opts.expectedDomain);
  }
  return { ok: false, reason: 'chain_unsupported' };
}

// ─── EVM (SIWE / EIP-4361) ──────────────────────────────────────────────

async function verifyEvm(env: OnboardEnvelope, expectedDomain?: string): Promise<VerifyResult> {
  let siwe: SiweMessage;
  try { siwe = new SiweMessage(env.message); }
  catch { return { ok: false, reason: 'envelope_malformed' }; }

  if (expectedDomain && siwe.domain !== expectedDomain) {
    return { ok: false, reason: 'domain_mismatch' };
  }
  if (!siwe.nonce) return { ok: false, reason: 'nonce_missing' };

  if (siwe.expirationTime) {
    const expMs = new Date(siwe.expirationTime).getTime();
    if (Number.isFinite(expMs) && expMs < Date.now()) {
      return { ok: false, reason: 'expired' };
    }
  }

  try {
    const result = await siwe.verify({ signature: env.signature });
    if (!result.success) return { ok: false, reason: 'signature_invalid' };
  } catch {
    return { ok: false, reason: 'signature_invalid' };
  }

  if (siwe.address.toLowerCase() !== env.address.toLowerCase()) {
    return { ok: false, reason: 'address_mismatch' };
  }

  const expSec = siwe.expirationTime
    ? Math.floor(new Date(siwe.expirationTime).getTime() / 1000)
    : nowSec() + 15 * 60;

  return {
    ok: true,
    token: {
      chain: 'evm',
      address: siwe.address.toLowerCase(),
      jti: siwe.nonce,
      expiresAtSec: expSec,
    },
  };
}

// ─── XRPL — native (GemWallet / Crossmark) ──────────────────────────────

interface XrplFields {
  domain?: string;
  address?: string;
  nonce?: string;
  expirationTime?: string;
}

function parseXrplMessage(msg: string): XrplFields {
  const out: XrplFields = {};
  const firstLine = msg.split('\n', 1)[0] ?? '';
  const dom = firstLine.match(/^(\S+)\s+wants you to sign in/);
  if (dom) out.domain = dom[1];

  const addr = msg.match(/(r[1-9A-HJ-NP-Za-km-z]{25,34})/);
  if (addr) out.address = addr[1];

  const kv = /^([A-Za-z ]+):\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = kv.exec(msg)) !== null) {
    const k = m[1].trim();
    const v = m[2].trim();
    if (k === 'Nonce') out.nonce = v;
    else if (k === 'Expiration Time') out.expirationTime = v;
  }
  return out;
}

function commonXrplChecks(env: OnboardEnvelope, expectedDomain?: string):
  { reason: VerifyRejectReason } | { nonce: string; expSec: number } {
  const parsed = parseXrplMessage(env.message);
  if (expectedDomain && parsed.domain !== expectedDomain) return { reason: 'domain_mismatch' };
  if (!parsed.address) return { reason: 'envelope_malformed' };
  if (!parsed.nonce) return { reason: 'nonce_missing' };
  if (parsed.address !== env.address) return { reason: 'address_mismatch' };
  if (parsed.expirationTime) {
    const expMs = new Date(parsed.expirationTime).getTime();
    if (Number.isFinite(expMs) && expMs < Date.now()) return { reason: 'expired' };
  }
  const expSec = parsed.expirationTime
    ? Math.floor(new Date(parsed.expirationTime).getTime() / 1000)
    : nowSec() + 15 * 60;
  return { nonce: parsed.nonce, expSec };
}

async function verifyXrplNative(env: OnboardEnvelope, expectedDomain?: string): Promise<VerifyResult> {
  if (!env.publicKey) return { ok: false, reason: 'envelope_malformed' };
  const pre = commonXrplChecks(env, expectedDomain);
  if ('reason' in pre) return { ok: false, reason: pre.reason };

  // ripple-keypairs verifies over the *hex-encoded* message bytes. This is
  // the same encoding GemWallet + Crossmark produce client-side (they call
  // `sign(hex(utf8(msg)), privkey)` under the hood).
  const messageHex = Buffer.from(env.message, 'utf8').toString('hex');
  let sigOk = false;
  try { sigOk = rippleVerify(messageHex, env.signature, env.publicKey); } catch { sigOk = false; }
  if (!sigOk) return { ok: false, reason: 'signature_invalid' };

  let derived: string;
  try { derived = deriveAddress(env.publicKey); } catch { return { ok: false, reason: 'signature_invalid' }; }
  if (derived !== env.address) return { ok: false, reason: 'address_mismatch' };

  return {
    ok: true,
    token: { chain: 'xrpl', address: env.address, jti: pre.nonce, expiresAtSec: pre.expSec },
  };
}

// ─── XRPL — Xaman (server-mediated OAuth2-style flow) ───────────────────

async function verifyXaman(env: OnboardEnvelope, opts: VerifyOptions): Promise<VerifyResult> {
  if (!env.xaman_uuid) return { ok: false, reason: 'envelope_malformed' };
  if (!opts.xaman) return { ok: false, reason: 'xaman_unavailable' };
  const pre = commonXrplChecks(env, opts.expectedDomain);
  if ('reason' in pre) return { ok: false, reason: pre.reason };

  const result = await opts.xaman.verifySignedPayload(env.xaman_uuid);
  if (!result || !result.signed) return { ok: false, reason: 'xaman_not_signed' };
  if (!result.account || result.account !== env.address) {
    return { ok: false, reason: 'address_mismatch' };
  }

  return {
    ok: true,
    token: { chain: 'xrpl', address: env.address, jti: pre.nonce, expiresAtSec: pre.expSec },
  };
}
