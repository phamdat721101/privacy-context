'use client';

/**
 * useXamanPayment — sign an RLUSD payment via Xaman (deep-link/QR), no
 * browser extension required. Q4/Q7: Xaman only for v1.
 *
 * Calls the API's server-side Xaman routes (`/v3/credits/xaman/*`) instead
 * of Xaman's Payload API directly — the API key/secret (XUMM_API_KEY/
 * XUMM_API_SECRET) stay server-only, same posture as the existing
 * onboard-sign-in flow in xamanClient.ts. No NEXT_PUBLIC_XAMAN_API_KEY is
 * needed or read by this hook.
 *
 * Flow:
 *   1. createPayment(pack_usdc) → POSTs to /v3/credits/xaman/create-payment,
 *      returns a QR/deep-link the caller renders.
 *   2. Poll /v3/credits/xaman/:uuid until the user signs (or it expires).
 *   3. On success, the resolved payload includes the settled `tx_hash` —
 *      the caller (TopUpModal) POSTs that hash to `/v3/credits/topup-xrpl`,
 *      which independently confirms the transfer on-ledger before granting
 *      credits. This hook never claims success itself — it only reports
 *      what the server reports.
 *
 * SRP: this hook owns Xaman deep-link polling mechanics only. It knows
 * nothing about credits or the grant endpoint.
 */

import { useCallback, useRef, useState } from 'react';
import { AGENT_BACKEND_URL } from '@/lib/contracts';

export type XamanPaymentStatus = 'idle' | 'creating' | 'awaiting_signature' | 'signed' | 'expired' | 'rejected' | 'error';

export interface XamanPaymentResult {
  status: XamanPaymentStatus;
  qrPngUrl: string | null;
  deepLink: string | null;
  txHash: string | null;
  error: string | null;
  start: (packUsd: number) => Promise<void>;
  reset: () => void;
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes — Xaman payloads expire around here anyway

export function useXamanPayment(): XamanPaymentResult {
  const [status, setStatus] = useState<XamanPaymentStatus>('idle');
  const [qrPngUrl, setQrPngUrl] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const reset = useCallback(() => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    setStatus('idle');
    setQrPngUrl(null);
    setDeepLink(null);
    setTxHash(null);
    setError(null);
  }, []);

  const start = useCallback(async (packUsd: number) => {
    reset();
    setStatus('creating');
    try {
      const createRes = await fetch(`${AGENT_BACKEND_URL}/v3/credits/xaman/create-payment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pack_usdc: packUsd }),
      });
      const created = await createRes.json().catch(() => ({}));
      if (!createRes.ok) throw new Error(created.error ?? `HTTP ${createRes.status}`);

      setQrPngUrl(created.qr ?? null);
      setDeepLink(created.deeplink ?? null);
      setStatus('awaiting_signature');

      const startedAt = Date.now();
      pollTimer.current = setInterval(async () => {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setStatus('expired');
          setError('Payment request expired, try again.');
          return;
        }
        try {
          const pollRes = await fetch(`${AGENT_BACKEND_URL}/v3/credits/xaman/${created.uuid}`);
          if (!pollRes.ok) return; // transient — keep polling
          const result = await pollRes.json();
          if (result?.expired) {
            if (pollTimer.current) clearInterval(pollTimer.current);
            setStatus('expired');
            setError('Payment request expired, try again.');
            return;
          }
          if (!result?.signed) return; // still pending

          if (pollTimer.current) clearInterval(pollTimer.current);
          if (result.settled && result.tx_hash) {
            setTxHash(result.tx_hash);
            setStatus('signed');
          } else {
            setStatus('rejected');
            setError('Payment was rejected or did not settle.');
          }
        } catch {
          // transient network error — keep polling until timeout
        }
      }, POLL_INTERVAL_MS);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [reset]);

  return { status, qrPngUrl, deepLink, txHash, error, start, reset };
}
