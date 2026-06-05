'use client';

/**
 * useMemWalAdapter — frontend façade for /v3/memory/* routes.
 *
 * Why thin: delegate private keys live ONLY on the API server. The browser
 * never holds them. This hook is a typed fetch wrapper that:
 *   - auto-injects the `x-wallet-address` + `x-chain: sui` headers
 *   - fails fast on non-Sui networks (mirrors the server-side requireSuiWallet)
 *   - normalises error envelopes into a single `{ code, message, retryAfterMs }`
 *
 * SOLID:
 *  - SRP: HTTP wrapper. No state, no caching beyond React Query if added later.
 *  - DIP: pages depend on this hook, never on `fetch` strings to /v3/memory.
 */

import { useCallback, useMemo } from 'react';
import { useNetwork } from './useNetwork';
import { isSuiNetwork } from '@/lib/networks';

const API_URL =
  process.env.NEXT_PUBLIC_AGENT_BACKEND_URL ?? 'http://localhost:3001';

// Warn loudly during dev when the env is unset — the production build bakes
// the value at compile time, so a missing env at build means every fetch
// in this hook will hit the Next.js 404 and return HTML instead of JSON.
if (
  typeof window !== 'undefined' &&
  !process.env.NEXT_PUBLIC_AGENT_BACKEND_URL &&
  process.env.NODE_ENV !== 'production'
) {
  // eslint-disable-next-line no-console
  console.warn(
    '[useMemWalAdapter] NEXT_PUBLIC_AGENT_BACKEND_URL is not set; falling back to http://localhost:3001',
  );
}

export interface MemWalRecallHit {
  blob_id: string;
  text: string;
  distance: number;
  namespace?: string;
}

export interface MemWalAdapterError extends Error {
  code: string;
  retryAfterMs?: number;
  details?: Record<string, unknown>;
  /** HTTP status on transport errors (set when the API is unreachable). */
  status?: number;
}

interface RememberArgs {
  text: string;
  namespace?: string;
}
interface RecallArgs {
  query: string;
  limit?: number;
  namespace?: string;
  minRelevance?: number;
}
interface RestoreArgs {
  namespace: string;
  limit?: number;
}

interface MemWalStatus {
  network: 'mainnet' | 'testnet' | 'local';
  peerDepEnabled: boolean;
  delegatesConfigured: number;
  relayerUrl: string;
}

function buildError(payload: unknown, status: number): MemWalAdapterError {
  const p = (payload ?? {}) as { error?: string; message?: string; retry_after_ms?: number; details?: Record<string, unknown> };
  const err = new Error(p.message ?? p.error ?? `HTTP ${status}`) as MemWalAdapterError;
  err.code = p.error ?? `HTTP_${status}`;
  err.retryAfterMs = p.retry_after_ms;
  err.details = p.details;
  return err;
}

export function useMemWalAdapter(walletAddress: string | undefined) {
  const { network } = useNetwork();
  const onSui = isSuiNetwork(network);

  const headers = useMemo<Record<string, string>>(
    () => ({
      'Content-Type': 'application/json',
      'x-chain': 'sui',
      ...(walletAddress ? { 'x-wallet-address': walletAddress } : {}),
    }),
    [walletAddress],
  );

  const post = useCallback(
    async <T>(path: string, body: unknown): Promise<T> => {
      if (!onSui) {
        const err = new Error('switch to Sui to use Walrus Memory') as MemWalAdapterError;
        err.code = 'NETWORK_NOT_SUI';
        throw err;
      }
      const url = `${API_URL}/v3/memory${path}`;
      const r = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      // Defensive parsing: when NEXT_PUBLIC_AGENT_BACKEND_URL is unset
      // (or wrong), the request is served by the Next.js dev/prod 404
      // and returns an HTML body. Without the content-type guard,
      // `JSON.parse` would throw a cryptic "Unexpected token '<'" error.
      const ct = r.headers.get('content-type') ?? '';
      const text = await r.text();
      if (!ct.includes('application/json')) {
        const e = new Error(
          `API at ${url} returned ${ct || 'unknown content-type'} (status ${r.status}). ` +
            `Set NEXT_PUBLIC_AGENT_BACKEND_URL to your API origin and rebuild the frontend.`,
        ) as MemWalAdapterError;
        e.code = 'API_UNREACHABLE';
        e.status = r.status;
        throw e;
      }
      const json = text ? JSON.parse(text) : {};
      if (!r.ok) throw buildError(json, r.status);
      return json as T;
    },
    [headers, onSui],
  );

  const remember = useCallback(
    (args: RememberArgs) => post<{ ok: true; blob_id: string | null; job_id: string | null }>('/remember', args),
    [post],
  );

  const recall = useCallback(
    (args: RecallArgs) => post<{ ok: true; results: MemWalRecallHit[]; total: number }>('/recall', args),
    [post],
  );

  const restore = useCallback(
    (args: RestoreArgs) => post<{ ok: true; restored: number; skipped: number; total: number }>('/restore', args),
    [post],
  );

  const status = useCallback(async (): Promise<MemWalStatus> => {
    const r = await fetch(`${API_URL}/v3/memory/status`);
    if (!r.ok) throw buildError(await r.json().catch(() => ({})), r.status);
    return r.json();
  }, []);

  return { onSui, remember, recall, restore, status };
}
