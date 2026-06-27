'use client';

/**
 * /messages/[threadId] — PRD-2 thread detail.
 *
 * Renders the message list, the per-message TEE attestation badge, and a
 * send box that POSTs to /v3/threads/:id/messages.
 */

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useThread } from '@/hooks/useThread';

export default function MessageDetailPage() {
  const params = useParams<{ threadId: string }>();
  const { thread, messages, loading, error, send } = useThread(params.threadId);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);

  async function onSend() {
    if (!draft.trim() || sending) return;
    setSending(true);
    setSendErr(null);
    const r = await send(draft.trim());
    setSending(false);
    if (r.ok) setDraft('');
    else setSendErr(r.error ?? 'send_failed');
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/inbox" className="text-xs text-gray-500 hover:underline">
        ← Inbox
      </Link>

      <header className="mt-4">
        <h1 className="text-xl font-bold">Thread</h1>
        {thread && (
          <p className="mt-1 text-xs text-gray-500">
            agent {thread.agent_id} · {thread.message_count} message(s) ·{' '}
            <span className="font-mono">{thread.id}</span>
          </p>
        )}
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      </header>

      <section className="mt-6 space-y-3">
        {loading && messages.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
        )}

        {messages.map((m) => {
          const isBuyer = m.sender_type === 'buyer';
          return (
            <article
              key={m.id}
              className={
                'max-w-[85%] rounded-lg border p-3 ' +
                (isBuyer
                  ? 'ml-auto border-blue-200 bg-blue-50'
                  : 'mr-auto border-gray-200 bg-white')
              }
            >
              <header className="flex items-baseline justify-between gap-2 text-xs uppercase">
                <span className={isBuyer ? 'text-blue-700' : 'text-gray-700'}>
                  {m.sender_type} · {m.mode}
                </span>
                <time className="text-gray-500">{new Date(m.created_at).toLocaleString()}</time>
              </header>
              <p className="mt-2 whitespace-pre-wrap text-sm text-gray-900">{m.body}</p>
              <p
                className="mt-2 truncate font-mono text-[10px] text-gray-400"
                title={m.tee_attestation_hash}
              >
                ✓ attested {m.tee_attestation_hash.slice(0, 16)}…
              </p>
            </article>
          );
        })}

        {!loading && messages.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-500">No messages in this thread yet.</p>
        )}
      </section>

      <footer className="mt-8 border-t pt-4">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message…"
          rows={3}
          maxLength={4000}
          className="w-full rounded-md border border-gray-300 p-3 text-sm focus:border-black focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-gray-500">
            {sendErr ? <span className="text-red-700">{sendErr}</span> : `${draft.length} / 4000`}
          </span>
          <button
            onClick={onSend}
            disabled={sending || !draft.trim()}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </footer>
    </main>
  );
}
