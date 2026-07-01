import { createPublicClient, http, type WalletClient } from 'viem';
import { PermitUtils } from '@cofhe/sdk/permits';
import { arbitrumSepolia as viemArbitrumSepolia, arbitrum as viemArbitrum } from 'viem/chains';
import { SiweMessage } from 'siwe';
import type { SupportedChain } from '../client/chains';
import { getCofheClient } from '../client/cofheClient';

// ─── CoFHE encryption permit (unchanged — used by /v2 encrypted paths) ───────

export interface PermitOptions {
  contractAddress: `0x${string}`;
  agentAddress: `0x${string}`;
}

export async function createPermit(
  options: PermitOptions,
  chain: SupportedChain,
  signer: WalletClient,
): Promise<string> {
  const client = getCofheClient();

  const account = signer.account?.address
    ?? (await signer.getAddresses())[0];
  if (!account) throw new Error('No account found in wallet client');

  const viemChain = chain.id === 421614 ? viemArbitrumSepolia : viemArbitrum;
  const publicClient = createPublicClient({ chain: viemChain, transport: http(chain.rpcUrl) });
  await client.connect(publicClient as any, signer as any);

  const permit = account.toLowerCase() === options.agentAddress.toLowerCase()
    ? await client.permits.getOrCreateSelfPermit()
    : await client.permits.createSharing({
        issuer: account,
        recipient: options.agentAddress,
        name: `agent-permit-${options.agentAddress.slice(0, 8)}`,
      });

  return PermitUtils.export(permit);
}

// ─── Onboard token (PRD-H) ───────────────────────────────────────────────────
//
// Chain-agnostic single-use bearer. Two shapes fold into one wire envelope:
//   • EVM  — SIWE / EIP-4361 message signed via `personal_sign`; verified
//     server-side with `siwe`. Works on every EVM chain the wallet advertises.
//   • XRPL — SIWE-shaped message signed with the user's XRPL wallet
//     (Xaman / GemWallet / Crossmark); verified server-side with `xrpl`.
//
// Both produce the same base64url-encoded envelope that goes on the wire
// in the `x-openx-token` header. Backend routes never branch on chain
// after `onboardTokenService.verify()`; identity is the normalized address.
//
// Single-use is enforced server-side via the existing `onboard_permits_spent`
// jti ledger (nonce == jti). Default TTL 15 min.

export const DEFAULT_ONBOARD_TTL_SEC = 15 * 60;

export type OnboardChain = 'evm' | 'xrpl';

/** Envelope shape — must match packages/api/src/services/onboardTokenService.ts. */
export interface OnboardEnvelope {
  v: 1;
  chain: OnboardChain;
  address: string;
  message: string;
  signature: string;
  publicKey?: string;
}

export interface OnboardToken {
  /** base64url(JSON(envelope)) — the value the agent sends in `x-openx-token`. */
  serialized: string;
  /** The signed envelope, useful for debug/UX. */
  envelope: OnboardEnvelope;
  /** Nonce (== single-use jti). */
  jti: string;
  /** Issuance ceiling as unix epoch seconds. */
  expiresAtSec: number;
  /** Normalized address — lowercased for EVM; unchanged for XRPL. */
  walletAddress: string;
}

export interface BuildMessageOptions {
  chain: OnboardChain;
  /** Account address (0x… or r…). */
  address: string;
  /** Origin host, e.g. `openx.the-valley.xyz`. */
  domain: string;
  /** Full URI, e.g. `https://openx.the-valley.xyz`. */
  uri: string;
  /** EVM chainId; ignored for XRPL. Defaults to 1 for EVM. */
  chainId?: number;
  /** Nonce — MUST equal jti so the server can enforce single-use. */
  nonce: string;
  /** Human-readable statement. */
  statement?: string;
  /** Absolute expiration seconds. Defaults to now + 15 min. */
  expiresAtSec?: number;
}

const DEFAULT_STATEMENT = 'Enable this device to publish agents on OpenX.';

/**
 * Build the canonical message string that the wallet signs.
 * Pure — no I/O, no signer.
 */
export function buildOnboardMessage(opts: BuildMessageOptions): string {
  const issuedAt = new Date();
  const expSec = opts.expiresAtSec ?? Math.floor(issuedAt.getTime() / 1000) + DEFAULT_ONBOARD_TTL_SEC;
  const expirationTime = new Date(expSec * 1000).toISOString();
  const statement = opts.statement ?? DEFAULT_STATEMENT;

  if (opts.chain === 'evm') {
    return new SiweMessage({
      domain: opts.domain,
      address: opts.address,
      statement,
      uri: opts.uri,
      version: '1',
      chainId: opts.chainId ?? 1,
      nonce: opts.nonce,
      issuedAt: issuedAt.toISOString(),
      expirationTime,
    }).prepareMessage();
  }

  // XRPL — SIWE-shaped but chain header is "Chain: XRPL" (SIWE spec has no
  // chainId concept for XRPL; the message stays human-readable regardless).
  return [
    `${opts.domain} wants you to sign in with your XRPL account:`,
    opts.address,
    '',
    statement,
    '',
    `URI: ${opts.uri}`,
    `Version: 1`,
    `Chain: XRPL`,
    `Nonce: ${opts.nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${expirationTime}`,
  ].join('\n');
}

/** base64url(JSON(env)) — used by the wire header. Works in Node and in
 *  every browser bundler, without relying on `Buffer.toString('base64url')`
 *  (which some polyfills don't implement). */
export function encodeEnvelope(env: OnboardEnvelope): string {
  const json = JSON.stringify(env);
  let b64: string;
  if (typeof btoa !== 'undefined') {
    // Browser path — btoa needs a latin-1 string, so UTF-8 → percent-encode → binary.
    b64 = btoa(unescape(encodeURIComponent(json)));
  } else {
    // Node path — plain base64 is universally supported.
    b64 = Buffer.from(json, 'utf8').toString('base64');
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Sign an EVM onboard token via a viem WalletClient (Privy or injected).
 * The wallet renders the SIWE canonical string as plain text — no raw
 * EIP-712 typed data, no `verifyingContract`, no `chainId` warning.
 */
export async function createEvmOnboardToken(
  opts: BuildMessageOptions & { signer: WalletClient },
): Promise<OnboardToken> {
  const account = opts.signer.account?.address ?? (await opts.signer.getAddresses())[0];
  if (!account) throw new Error('createEvmOnboardToken: no account in signer');

  // IMPORTANT: keep the address in its wallet-native (checksummed) form for
  // both the SIWE message and the signMessage call — Privy's provider does
  // a strict-case account check and rejects lowercased addresses. The
  // server-side verifier normalizes case at compare time, so we only
  // lowercase inside the envelope's `address` field for wire-level
  // canonicalization.
  const address = opts.address ?? account;
  const message = buildOnboardMessage({ ...opts, address });
  const signature = await opts.signer.signMessage({
    account: opts.signer.account ?? account,
    message,
  });

  const envelope: OnboardEnvelope = {
    v: 1,
    chain: 'evm',
    address: address.toLowerCase(),
    message,
    signature,
  };
  return {
    serialized: encodeEnvelope(envelope),
    envelope,
    jti: opts.nonce,
    expiresAtSec: opts.expiresAtSec ?? Math.floor(Date.now() / 1000) + DEFAULT_ONBOARD_TTL_SEC,
    walletAddress: address.toLowerCase(),
  };
}

/**
 * Wrap an XRPL wallet's signature into the wire envelope.
 * XRPL browser wallets (GemWallet / Crossmark / Xaman) return the raw
 * signature + publicKey; this helper canonicalizes the envelope so callers
 * never touch base64url encoding themselves.
 */
export function wrapXrplOnboardToken(opts: {
  address: string;
  publicKey: string;
  signature: string;
  message: string;
  jti: string;
  expiresAtSec?: number;
}): OnboardToken {
  const envelope: OnboardEnvelope = {
    v: 1,
    chain: 'xrpl',
    address: opts.address,
    message: opts.message,
    signature: opts.signature,
    publicKey: opts.publicKey,
  };
  return {
    serialized: encodeEnvelope(envelope),
    envelope,
    jti: opts.jti,
    expiresAtSec: opts.expiresAtSec ?? Math.floor(Date.now() / 1000) + DEFAULT_ONBOARD_TTL_SEC,
    walletAddress: opts.address,
  };
}
