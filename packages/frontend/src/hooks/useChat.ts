'use client';
import { useState } from 'react';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import type { ChatMessage } from '@/types/context';
import type { PermitReason } from './usePermit';

export function useChat(
  userAddress: `0x${string}` | undefined,
  onAuthError?: (reason: PermitReason) => void,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSubscription, setNeedsSubscription] = useState(false);

  async function sendMessage(content: string, brainId?: string, mode: 'learn' | 'store' = 'learn') {
    if (!userAddress) return;

    const userMsg: ChatMessage = { role: 'user', content, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    setError(null);
    setNeedsSubscription(false);

    try {
      const res = await fetch(`${AGENT_BACKEND_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-wallet-address': userAddress },
        body: JSON.stringify({ message: content, brainId: brainId || null, mode }),
      });

      if (res.status === 402) {
        setNeedsSubscription(true);
        setError('Subscription required. Please subscribe to continue.');
        return;
      }

      if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        const reason: PermitReason = body.reason ?? 'never_authorized';
        onAuthError?.(reason);
        setError('FHE permit required — re-authorize to continue.');
        return;
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: data.response ?? data.reply ?? '',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to send message');
    } finally {
      setLoading(false);
    }
  }

  return { messages, sendMessage, loading, error, needsSubscription };
}
