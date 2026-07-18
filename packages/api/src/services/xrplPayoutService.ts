/**
 * xrplPayoutService — thin wrapper around n-payment's XRPL client for the
 * RLUSD-on-XRPL-testnet withdrawal rail. Mirrors the existing inline
 * ethers.js block in v3-marketplace.ts's `/seller/withdraw` handler, but as
 * its own module — this is a new settlement rail, not a modification of the
 * Arbitrum one.
 *
 * SOLID:
 *   * SRP — this file owns XRPL send + trustline-check calls only. It does
 *     not touch credit_ledger / seller_balances (creditService's job) or
 *     decide withdrawal eligibility (the route handler's job).
 *   * DIP — the route handler calls `sendRlusd()` / `checkTrustline()`; it
 *     doesn't know n-payment's API shape or that XRPL is involved under the
 *     hood, same abstraction level as the ethers.js call it replaces.
 *
 * Fail-fast trustline policy (Q5): the PLATFORM wallet auto-creates its own
 * trustline via n-payment's `xrpl.seed` config (handled inside
 * createXrplClient/createPaywall — not this file's concern). The SELLER's
 * trustline is never auto-created; `checkTrustline()` only reads state via
 * `account_lines` so the withdraw route can fail fast with an actionable
 * error instead of attempting a doomed send.
 */

import { logger } from '../lib';

// Per n-payment's own RLUSD_ISSUERS map (confirmed via live trustline test
// against XRPL testnet, 2026-07-17): testnet and mainnet use DIFFERENT
// issuer addresses. Defaulting to the mainnet issuer here would silently
// break every testnet trustline check — this bug was caught by actually
// running ensureTrustLine() against a funded testnet wallet, not by reading
// docs alone.
const RLUSD_ISSUERS: Record<'testnet' | 'mainnet', string> = {
  testnet: 'rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV',
  mainnet: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',
};
const RLUSD_CURRENCY = '524C555344000000000000000000000000000000'; // 'RLUSD' hex-padded, per XRPL 160-bit currency code convention

export type XrplSendResult =
  | { ok: true; tx_hash: string }
  | { ok: false; reason: 'not_configured' | 'send_failed'; detail?: string };

export type TrustlineCheckResult =
  | { ok: true; hasTrustline: boolean }
  | { ok: false; reason: 'not_configured' | 'check_failed'; detail?: string };

function isEnabled(): boolean {
  return process.env.XRPL_RLUSD_ENABLED === 'true';
}

function getPlatformSeed(): string | undefined {
  return process.env.XRPL_PLATFORM_PAYOUT_SEED;
}

function getNetwork(): 'testnet' | 'mainnet' {
  return process.env.XRPL_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
}

/**
 * Lazily import n-payment the same way credits-topup.ts does — keeps the
 * dependency dynamic so builds that don't need XRPL never pay the import
 * cost, and so `tsc` under `module: commonjs` doesn't rewrite the import.
 */
async function loadNPayment(): Promise<any | null> {
  try {
    const dynamicImport: (m: string) => Promise<any> = Function('m', 'return import(m)') as any;
    return await dynamicImport('n-payment');
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'xrplPayoutService: failed to load n-payment');
    return null;
  }
}

/**
 * Send RLUSD from the platform's XRPL testnet wallet to `destination`.
 * Direct analogue of the ethers.js `USDC.transfer` call in the Arbitrum
 * withdraw path — this is the ONLY function in this module that moves
 * funds. Callers must have already validated the seller's trustline via
 * `checkTrustline()` before calling this.
 */
export async function sendRlusd(destination: string, amountUsd: number): Promise<XrplSendResult> {
  if (!isEnabled()) return { ok: false, reason: 'not_configured', detail: 'XRPL_RLUSD_ENABLED is not true' };
  const seed = getPlatformSeed();
  if (!seed) return { ok: false, reason: 'not_configured', detail: 'XRPL_PLATFORM_PAYOUT_SEED unset' };

  const np = await loadNPayment();
  if (!np?.createXrplClient) {
    return { ok: false, reason: 'not_configured', detail: 'n-payment XRPL client unavailable' };
  }

  try {
    const client = np.createXrplClient({ seed, network: getNetwork() });
    await client.ensureTrustLine(); // platform's own trustline — auto-create per Q5
    const { hash } = await client.sendRLUSD(destination, amountUsd.toFixed(2));

    // CRITICAL: n-payment's sendRLUSD() returns `{hash, validated}` where
    // `validated` only means "this ledger closed with the tx included" —
    // it does NOT mean the payment succeeded. A `tec*`-class result (e.g.
    // tecPATH_DRY — no path/balance to actually deliver the funds) is
    // "validated" but moved zero money. Caught live: a real withdraw in
    // this session returned {ok:true, tx_hash} from the old code while the
    // transaction had engine result tecPATH_DRY and delivered nothing —
    // the DB was marked paid, the seller received nothing. Always re-fetch
    // the transaction and check its actual engine result before returning
    // success.
    const rpcClient = await client.connection.getClient();
    const txResult = await rpcClient.request({ command: 'tx', transaction: hash });
    await client.disconnect?.();

    const engineResult = txResult?.result?.meta?.TransactionResult;
    if (engineResult !== 'tesSUCCESS') {
      logger.error(
        { destination, amountUsd, tx_hash: hash, engineResult },
        'xrplPayoutService:sendRlusd:tec_failure',
      );
      return {
        ok: false,
        reason: 'send_failed',
        detail: `Transaction ${hash} engine result: ${engineResult ?? 'unknown'} (submitted but did not deliver funds)`,
      };
    }

    logger.info({ destination, amountUsd, tx_hash: hash }, 'xrplPayoutService:sendRlusd:ok');
    return { ok: true, tx_hash: hash };
  } catch (err) {
    logger.error(
      { err: (err as Error).message, destination, amountUsd },
      'xrplPayoutService:sendRlusd:failed',
    );
    return { ok: false, reason: 'send_failed', detail: (err as Error).message };
  }
}

export type VerifyPaymentResult = { ok: true } | { ok: false; detail: string };

/**
 * Independently verify an XRPL testnet transaction actually delivered
 * `amountUsd` RLUSD to `expectedDestination`. Mirrors the ERC-20
 * Transfer-log check in `/v3/credits/topup` (v3.ts) — the buyer signs
 * client-side (Xaman), the server never trusts the client's claim, it reads
 * the transaction back from the ledger itself.
 */
export async function verifyRlusdPayment(
  txHash: string,
  expectedDestination: string,
  amountUsd: number,
): Promise<VerifyPaymentResult> {
  if (!isEnabled()) return { ok: false, detail: 'XRPL_RLUSD_ENABLED is not true' };

  const np = await loadNPayment();
  if (!np?.createXrplClient) return { ok: false, detail: 'n-payment XRPL client unavailable' };

  try {
    const client = np.createXrplClient({ network: getNetwork() });
    const tx = await client.getTransaction?.(txHash);
    await client.disconnect?.();
    if (!tx || tx.validated !== true) {
      return { ok: false, detail: 'transaction not found or not validated' };
    }
    const delivered = tx.meta?.delivered_amount ?? tx.DeliverMax ?? tx.Amount;
    const destination = String(tx.Destination ?? '').trim();
    const deliveredValue = typeof delivered === 'object' ? Number(delivered.value) : NaN;
    const deliveredCurrency = typeof delivered === 'object' ? delivered.currency : null;

    if (destination !== expectedDestination) {
      return { ok: false, detail: `destination mismatch: got ${destination}` };
    }
    if (deliveredCurrency !== RLUSD_CURRENCY && deliveredCurrency !== 'RLUSD') {
      return { ok: false, detail: `currency mismatch: got ${deliveredCurrency}` };
    }
    if (!Number.isFinite(deliveredValue) || Math.abs(deliveredValue - amountUsd) > 0.01) {
      return { ok: false, detail: `amount mismatch: expected ${amountUsd}, got ${deliveredValue}` };
    }
    return { ok: true };
  } catch (err) {
    logger.error({ err: (err as Error).message, txHash }, 'xrplPayoutService:verifyRlusdPayment:failed');
    return { ok: false, detail: (err as Error).message };
  }
}

/**
 * Fail-fast check: does `address` already hold an RLUSD trust line? Never
 * creates one — the seller is responsible for their own trustline (Q5).
 * Uses a raw `account_lines` read (no signature, no fee), same pattern the
 * xrpl-rlusd-merchant skill documents for the auto-trustline cache check.
 */
export async function checkTrustline(address: string): Promise<TrustlineCheckResult> {
  if (!isEnabled()) return { ok: false, reason: 'not_configured', detail: 'XRPL_RLUSD_ENABLED is not true' };

  const np = await loadNPayment();
  if (!np?.createXrplClient) {
    return { ok: false, reason: 'not_configured', detail: 'n-payment XRPL client unavailable' };
  }

  try {
    // n-payment's XrplClient has no public `getAccountLines` helper — an
    // earlier draft assumed one existed and (via `?.()` optional chaining)
    // silently no-op'd, always returning `hasTrustline: false` regardless
    // of the real on-ledger state. Caught by actually running this against
    // a funded testnet wallet with a real trustline (2026-07-17) — the bug
    // was invisible from a code read alone. Fix: reuse the same
    // `connection.getClient()` + raw `account_lines` RPC that
    // `ensureTrustLine()` uses internally (confirmed via the installed
    // package's own source).
    const seed = getPlatformSeed();
    const client = np.createXrplClient(seed ? { seed, network: getNetwork() } : { network: getNetwork() });
    const rpcClient = await client.connection.getClient();
    const result = await rpcClient.request({ command: 'account_lines', account: address });
    await client.disconnect?.();
    const lines = result?.result?.lines;
    const expectedIssuer = process.env.XRPL_RLUSD_ISSUER ?? RLUSD_ISSUERS[getNetwork()];
    const hasTrustline = Array.isArray(lines)
      ? lines.some((l: any) => l.currency === RLUSD_CURRENCY && l.account === expectedIssuer)
      : false;
    return { ok: true, hasTrustline };
  } catch (err) {
    logger.error({ err: (err as Error).message, address }, 'xrplPayoutService:checkTrustline:failed');
    return { ok: false, reason: 'check_failed', detail: (err as Error).message };
  }
}
