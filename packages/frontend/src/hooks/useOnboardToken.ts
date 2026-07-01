'use client';

/**
 * useOnboardToken — PRD-H.
 *
 * Single hook, four wallet paths, one envelope out.
 *
 * SOLID:
 *   - SRP: this hook owns onboard-token creation for the browser. Server
 *     verification lives in packages/api/src/services/onboardTokenService.
 *   - Open/Closed: adding a wallet = one new `generateX()` helper + one
 *     entry in `AVAILABLE_KINDS`. Downstream consumers keep the same shape.
 *   - DIP: EVM signing comes through the shared viem WalletClient plumbing;
 *     XRPL signing goes through each wallet's official SDK. No cross-wallet
 *     coupling.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createWalletClient, custom } from 'viem';
import { arbitrumSepolia as viemArbitrumSepolia } from 'viem/chains';
import { usePrivy } from '@privy-io/react-auth';
import { usePrivyEvmAddress, usePrivyEvmWallet } from '@/hooks/useActiveWallet';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import {
  buildOnboardMessage,
  createEvmOnboardToken,
  wrapXrplOnboardToken,
  encodeEnvelope,
  type OnboardToken,
} from '@fhe-ai-context/sdk';

export type OnboardWalletKind = 'evm' | 'gem' | 'crossmark' | 'xaman';

export interface OnboardTokenState {
  status: 'idle' | 'generating' | 'ready' | 'error';
  token: OnboardToken | null;
  error: string | null;
  availability: Record<OnboardWalletKind, boolean>;
  generate: (kind: OnboardWalletKind) => Promise<OnboardToken | null>;
  reset: () => void;
}

function currentDomain(): string {
  if (typeof window !== 'undefined') return window.location.host;
  return process.env.NEXT_PUBLIC_SIWE_DOMAIN ?? 'openx.the-valley.xyz';
}

function currentUri(): string {
  if (typeof window !== 'undefined') return window.location.origin;
  return `https://${currentDomain()}`;
}

async function fetchNonce(): Promise<{ nonce: string; expiresAtSec: number }> {
  const r = await fetch(`${AGENT_BACKEND_URL}/v3/onboard/nonce`);
  if (!r.ok) throw new Error(`nonce endpoint returned ${r.status}`);
  return r.json();
}

export function useOnboardToken(): OnboardTokenState {
  const { login, authenticated } = usePrivy();
  const evmAddress = usePrivyEvmAddress();
  const privyEvmWallet = usePrivyEvmWallet();

  const [status, setStatus] = useState<OnboardTokenState['status']>('idle');
  const [token, setToken] = useState<OnboardToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Record<OnboardWalletKind, boolean>>({
    evm: true,           // Privy handles the fallback (opens login modal if needed)
    gem: false,
    crossmark: false,
    xaman: true,         // server-mediated; always "available" from browser POV
  });

  // Detect XRPL wallets on mount (client only).
  useEffect(() => {
    let cancelled = false;
    async function detect() {
      const next: Record<OnboardWalletKind, boolean> = { evm: true, gem: false, crossmark: false, xaman: true };
      try {
        const { isInstalled } = await import('@gemwallet/api');
        const r = await isInstalled();
        next.gem = Boolean(r?.result?.isInstalled);
      } catch { /* dep missing or extension not present */ }
      try {
        // Crossmark injects `window.xrpl.isCrossmark` when the extension runs.
        next.crossmark = Boolean((globalThis as any).xrpl?.isCrossmark);
      } catch { /* ignore */ }
      if (!cancelled) setAvailability(next);
    }
    detect();
    return () => { cancelled = true; };
  }, []);

  // ─── Kind-specific generators ─────────────────────────────────────────

  const generateEvm = useCallback(async (): Promise<OnboardToken> => {
    if (!authenticated) { login(); throw new Error('Sign in to continue'); }
    if (!evmAddress || !privyEvmWallet) throw new Error('EVM wallet not ready');
    const { nonce, expiresAtSec } = await fetchNonce();
    const provider = await privyEvmWallet.getEthereumProvider();
    const walletClient = createWalletClient({
      chain: viemArbitrumSepolia,       // metadata only — the signature is chain-agnostic
      transport: custom(provider),
      account: evmAddress,
    });
    return createEvmOnboardToken({
      chain: 'evm',
      address: evmAddress,
      domain: currentDomain(),
      uri: currentUri(),
      chainId: 1,                        // shown to user only; not enforced server-side
      nonce,
      expiresAtSec,
      signer: walletClient,
    });
  }, [authenticated, login, evmAddress, privyEvmWallet]);

  const generateGem = useCallback(async (): Promise<OnboardToken> => {
    const gem = await import('@gemwallet/api');
    const inst = await gem.isInstalled();
    if (!inst?.result?.isInstalled) throw new Error('GemWallet not installed');
    const pk = await gem.getPublicKey();
    const address = pk.result?.address;
    const publicKey = pk.result?.publicKey;
    if (!address || !publicKey) throw new Error('GemWallet did not return address/publicKey');

    const { nonce, expiresAtSec } = await fetchNonce();
    const message = buildOnboardMessage({
      chain: 'xrpl', address, domain: currentDomain(), uri: currentUri(), nonce, expiresAtSec,
    });
    const signed = await gem.signMessage(message);
    const signature = signed.result?.signedMessage;
    if (!signature) throw new Error('GemWallet declined to sign');

    return wrapXrplOnboardToken({ address, publicKey, signature, message, jti: nonce, expiresAtSec });
  }, []);

  const generateCrossmark = useCallback(async (): Promise<OnboardToken> => {
    const mod = await import('@crossmarkio/sdk');
    const sdk: any = (mod as any).default ?? mod;
    const { nonce, expiresAtSec } = await fetchNonce();
    const message = buildOnboardMessage({
      chain: 'xrpl',
      address: '<will-be-filled>', // Crossmark returns the address after signing
      domain: currentDomain(),
      uri: currentUri(),
      nonce,
      expiresAtSec,
    });
    const hex = Buffer.from(message, 'utf8').toString('hex').toUpperCase();
    const resp = await sdk.methods.signInAndWait(hex);
    const address = resp?.response?.data?.address ?? resp?.response?.data?.account;
    const publicKey = resp?.response?.data?.publicKey ?? resp?.response?.data?.SigningPubKey;
    const signature = resp?.response?.data?.signature ?? resp?.response?.data?.TxnSignature;
    if (!address || !publicKey || !signature) {
      throw new Error('Crossmark returned an incomplete sign-in payload');
    }
    // Rebuild the message with the real address so parseXrplMessage matches.
    const finalMessage = buildOnboardMessage({
      chain: 'xrpl', address, domain: currentDomain(), uri: currentUri(), nonce, expiresAtSec,
    });
    return wrapXrplOnboardToken({ address, publicKey, signature, message: finalMessage, jti: nonce, expiresAtSec });
  }, []);

  const generateXaman = useCallback(async (): Promise<OnboardToken> => {
    const created = await fetch(`${AGENT_BACKEND_URL}/v3/onboard/xaman/create`, { method: 'POST' });
    if (created.status === 503) {
      setAvailability((prev) => ({ ...prev, xaman: false }));
      throw new Error('Xaman is not configured on this server. Try another wallet.');
    }
    if (!created.ok) throw new Error(`Xaman create returned ${created.status}`);
    const { uuid, deeplink, qr, nonce, expiresAtSec } = await created.json();
    // Best UX: open the deeplink in a new tab / show the QR. Here we open the
    // deeplink and poll — pages can render the QR themselves alongside this hook.
    if (typeof window !== 'undefined' && deeplink) window.open(deeplink, '_blank', 'noopener,noreferrer');

    const deadline = Date.now() + 3 * 60_000; // poll up to 3 min
    while (Date.now() < deadline) {
      const r = await fetch(`${AGENT_BACKEND_URL}/v3/onboard/xaman/${uuid}`);
      if (r.ok) {
        const body = await r.json();
        if (body.signed && body.envelope) {
          return {
            envelope: body.envelope,
            serialized: encodeEnvelope(body.envelope),
            jti: nonce,
            expiresAtSec,
            walletAddress: body.envelope.address,
          };
        }
        if (body.expired) throw new Error('Xaman payload expired before signing');
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error('Xaman sign-in timed out');
  }, []);

  const generate = useCallback(async (kind: OnboardWalletKind): Promise<OnboardToken | null> => {
    setStatus('generating');
    setError(null);
    try {
      let next: OnboardToken;
      switch (kind) {
        case 'evm':       next = await generateEvm(); break;
        case 'gem':       next = await generateGem(); break;
        case 'crossmark': next = await generateCrossmark(); break;
        case 'xaman':     next = await generateXaman(); break;
        default: throw new Error(`unknown wallet kind: ${kind}`);
      }
      setToken(next);
      setStatus('ready');
      return next;
    } catch (err) {
      // Surface the most specific field wallets typically populate:
      //   viem       → err.shortMessage
      //   wallet     → err.details / err.cause?.message
      //   plain      → err.message
      //   non-Error  → String(err)
      const e = err as { shortMessage?: string; details?: string; message?: string; cause?: { message?: string } };
      const message =
        e?.shortMessage ??
        e?.details ??
        e?.message ??
        e?.cause?.message ??
        (typeof err === 'string' ? err : JSON.stringify(err)) ??
        'Unknown error';
      if (typeof console !== 'undefined') console.error('[useOnboardToken] generate failed', kind, err);
      setError(message);
      setStatus('error');
      return null;
    }
  }, [generateEvm, generateGem, generateCrossmark, generateXaman]);

  const reset = useCallback(() => {
    setToken(null);
    setStatus('idle');
    setError(null);
  }, []);

  return useMemo(
    () => ({ status, token, error, availability, generate, reset }),
    [status, token, error, availability, generate, reset],
  );
}
