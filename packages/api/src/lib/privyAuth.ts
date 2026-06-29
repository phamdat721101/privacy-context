/**
 * privyAuth — server-side Privy access-token verification.
 *
 * Used by the auth middleware to extract a Sybil-resistant Privy user id
 * so the credit-system welcome bonus can be granted per Privy user (rather
 * than per wallet, which is trivially Sybil-able).
 *
 * Single responsibility: token → `{ user_id }`. The middleware decides what
 * to do with the resolved id (currently: pass it into creditService.ensureAccount).
 *
 * Graceful when `PRIVY_APP_SECRET` is unset — `verifyPrivyToken` returns
 * `null` and the caller continues without Sybil resistance. We log a single
 * warn at first miss instead of crashing dev environments.
 */

import { logger } from './';

let cachedClient: { verifyAuthToken(token: string): Promise<{ userId: string }> } | null = null;
let initTried = false;
let initFailed = false;

async function getClient() {
  if (cachedClient || initFailed) return cachedClient;
  if (initTried) return cachedClient;
  initTried = true;

  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    logger.warn(
      { has_app_id: !!appId, has_app_secret: !!appSecret },
      'privyAuth: PRIVY_APP_ID / PRIVY_APP_SECRET unset — welcome bonus will be wallet-bound',
    );
    initFailed = true;
    return null;
  }
  try {
    // Lazy require so a missing package never crashes startup. Adding the
    // dep is part of the same PR but we want dev environments without the
    // install to still boot.
    const dynamicImport: (m: string) => Promise<any> = Function('m', 'return import(m)') as any;
    const mod: any = await dynamicImport('@privy-io/server-auth');
    const Privy = mod.PrivyClient ?? mod.default;
    cachedClient = new Privy(appId, appSecret);
    logger.info({ appId }, 'privyAuth: client initialised');
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'privyAuth: failed to initialise — wallet-only mode');
    initFailed = true;
  }
  return cachedClient;
}

/**
 * Verify a Privy access token. Returns `null` when the token is missing,
 * malformed, expired, OR when the Privy SDK is not configured.
 *
 * Never throws — bad tokens degrade gracefully to wallet-only auth.
 */
export async function verifyPrivyToken(token: string | undefined | null): Promise<string | null> {
  if (!token || typeof token !== 'string') return null;
  const client = await getClient();
  if (!client) return null;
  try {
    const verified = await client.verifyAuthToken(token);
    return verified.userId ?? null;
  } catch (err) {
    logger.debug({ err: (err as Error).message }, 'privyAuth: token verification failed');
    return null;
  }
}
