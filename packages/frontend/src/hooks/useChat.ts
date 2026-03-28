'use client';
import { useState } from 'react';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import type { ChatMessage } from '@/types/context';

export function useChat(userAddress: `0x${string}` | undefined, serializedPermit: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendMessage(content: string) {
    if (!userAddress || !serializedPermit) return;

    const userMsg: ChatMessage = { role: 'user', content, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${AGENT_BACKEND_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress, message: content, serializedPermit }),
      });

      const data = await res.json() as { response?: string; error?: string };

      if (!res.ok) {
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: data.response ?? '',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to send message');
    } finally {
      setLoading(false);
    }
  }

  return { messages, sendMessage, loading, error };
}
