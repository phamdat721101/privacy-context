'use client';

/**
 * useThread — buyer-side thread reader + sender hook (PRD-2 M2/M4).
 *
 * Reads via GET /v3/threads/:id/messages. Sends via the n-payment x402
 * paywall on POST /api/v1/<slug> with `tool: "message"` (M4 microbill).
 * For MVP we expose `send(body)` returning the new message body —
 * client-side x402 payment is wired by the embedded n-payment client when
 * `clientFetch` is provided, otherwise the call uses the plain authed path
 * via /v3/threads/:id/messages (no microbill in dev mode).
 */

import { useCallback, useEffect, useState } from 'react';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import { useActiveWallet } from '@/hooks/useActiveWallet';

export interface ThreadMessage {
  id: string;
  thread_id: string;
  sender_type: 'buyer' | 'agent' | 'operator' | 'system';
  sender_id: string;
  mode: 'm1' | 'm2' | 'm3' | 'm4';
  body: string;
  tee_attestation_hash: string;
  created_at: string;
}

export interface Thread {
  id: string;
  buyer_wallet: string;
  agent_id: string;
  status: string;
  message_count: number;
  last_message_at: string;
  origin_paid_call_id: string | null;
  created_at: string;
}

export function useThread(threadId: string | null) {
  const { address } = useActiveWallet();
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!threadId || !address) return;
    setLoading(true);
    try {
      const res = await fetch(`${AGENT_BACKEND_URL}/v3/threads/${threadId}/messages?limit=100`, {
        headers: { 'x-wallet-address': address },
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as { thread: Thread; messages: ThreadMessage[] };
      setThread(body.thread);
      setMessages(body.messages);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [threadId, address]);

  // initial load + SSE subscribe
  useEffect(() => {
    if (!threadId || !address) return;
    reload();
    // Open SSE stream and refresh on every event mentioning this thread.
    const url = new URL(`${AGENT_BACKEND_URL}/v3/inbox/stream`);
    // EventSource doesn't support custom headers — we pass wallet via query.
    url.searchParams.set('wallet', address);
    const es = new EventSource(url.toString(), { withCredentials: false });
    es.onmessage = (evt) => {
      try {
        const payload = JSON.parse(evt.data) as { thread_id?: string };
        if (payload.thread_id === threadId) reload();
      } catch {/* ignore */}
    };
    es.onerror = () => {
      es.close();
    };
    return () => es.close();
  }, [threadId, address, reload]);

  const send = useCallback(
    async (body: string): Promise<{ ok: boolean; error?: string }> => {
      if (!threadId || !address || !body.trim()) return { ok: false, error: 'missing_inputs' };
      try {
        // MVP send path — POST against the v3-comm thread. The microbilled
        // x402 path lives in /api/v1/<slug> with tool="message" and is wired
        // by the buyer's n-payment client when available.
        const res = await fetch(`${AGENT_BACKEND_URL}/v3/threads/${threadId}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-wallet-address': address },
          body: JSON.stringify({ body }),
        });
        if (!res.ok) return { ok: false, error: `status ${res.status}` };
        await reload();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
    [threadId, address, reload],
  );

  return { thread, messages, loading, error, send, reload };
}
