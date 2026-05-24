'use client';

/**
 * components/MemoryChat.tsx — read-back chat for sovereign-tier memory.
 *
 * The killer Pillar 2 demo: user asks a question, agent runs an
 * `ownedBy(yourWallet)` query against Arkiv, LLM cites only what it found.
 * Citations are clickable [n] tokens that resolve to the live Braga entity.
 *
 * SOLID:
 * - SRP: chat UI + one POST /v4/chat-with-memory call. No memory mutations,
 *   no balance probing, no signing.
 * - LSP: replaceable backend — flip AGENT_BACKEND_URL and the same UX works.
 */

import { useEffect, useRef, useState } from 'react';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import { ARKIV_DATA_EXPLORER } from '@/lib/arkiv';
import type { Hex } from 'viem';

interface Citation {
  index: number;
  entityKey: string;
  snippet: string;
  confidence: number;
  derivedAt: number;
}

interface ChatTurn {
  role: 'user' | 'agent';
  text: string;
  citations?: Citation[];
  memoriesConsidered?: number;
}

export function MemoryChat({ ownedBy, topicHints, prefill }: { ownedBy: Hex | null; topicHints?: string[]; prefill?: string | null }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // When the page asks us to prefill (post-save CTA), populate input + focus.
  useEffect(() => {
    if (prefill) {
      setInput(prefill);
      // Defer focus to next tick so the textarea is mounted + the value is set.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [prefill]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || busy || !ownedBy) return;
    setInput('');
    setTurns((t) => [...t, { role: 'user', text: q }]);
    setBusy(true);
    try {
      const res = await fetch(`${AGENT_BACKEND_URL}/v4/chat-with-memory`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q, ownedBy }),
      });
      const body = (await res.json()) as { answer?: string; citations?: Citation[]; memoriesConsidered?: number; error?: string };
      if (!res.ok || body.error) {
        setTurns((t) => [...t, { role: 'agent', text: `error: ${body.error ?? res.status}` }]);
      } else {
        setTurns((t) => [
          ...t,
          { role: 'agent', text: body.answer ?? '', citations: body.citations, memoriesConsidered: body.memoriesConsidered },
        ]);
      }
    } catch (err) {
      setTurns((t) => [...t, { role: 'agent', text: `error: ${(err as Error).message}` }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  if (!ownedBy) return null;

  return (
    <div className="rounded-xl border border-primary/30 bg-surface p-4">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-mono text-on-surface-variant">
        <span className="material-symbols-outlined text-[16px] text-primary">forum</span>
        <span className="uppercase tracking-widest">ask your memory</span>
        <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-primary">
          ownedBy {ownedBy.slice(0, 8)}…
        </span>
      </div>

      {turns.length === 0 ? (
        <p className="mb-3 text-sm italic text-on-surface-variant">
          {topicHints && topicHints.length > 0 ? (
            <>
              Try: <em>&ldquo;What did I save about <strong>{topicHints[0]}</strong>?&rdquo;</em>
              {topicHints[1] && (
                <> or <em>&ldquo;Summarise everything tagged <strong>#{topicHints[1]}</strong>&rdquo;</em></>
              )}.
            </>
          ) : (
            <>Try: <em>&ldquo;What did I save about FHE?&rdquo;</em> or <em>&ldquo;Summarise everything I tagged #arkiv-storage&rdquo;</em>.</>
          )}
        </p>
      ) : (
        <ul className="mb-3 space-y-3">
          {turns.map((t, i) => (
            <li key={i} className={t.role === 'user' ? 'text-right' : ''}>
              <div
                className={`inline-block max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                  t.role === 'user'
                    ? 'bg-primary/15 text-primary'
                    : 'border border-outline-variant/30 bg-surface-container-low text-on-surface'
                }`}
              >
                {renderWithCitations(t.text, t.citations ?? [])}
                {t.role === 'agent' && t.citations && t.citations.length > 0 && (
                  <CitationList citations={t.citations} />
                )}
                {t.role === 'agent' && typeof t.memoriesConsidered === 'number' && (
                  <div className="mt-1 font-mono text-[10px] text-on-surface-variant">
                    🧠 considered {t.memoriesConsidered} of your memories
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={send} className="flex gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(e); } }}
          rows={1}
          placeholder="Ask anything about your saved memories…"
          disabled={busy}
          className="flex-1 resize-none rounded-lg border border-outline-variant/40 bg-surface-container-low p-2 text-sm font-body outline-none focus:border-primary/60"
        />
        <button
          type="submit"
          disabled={!input.trim() || busy}
          className="rounded-full bg-primary px-4 text-sm font-medium text-on-primary disabled:opacity-50"
        >
          {busy ? '…' : 'Ask'}
        </button>
      </form>
    </div>
  );
}

function renderWithCitations(text: string, citations: Citation[]): React.ReactNode {
  if (citations.length === 0) return text;
  const byIdx = new Map(citations.map((c) => [c.index, c]));
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (!m) return <span key={i}>{part}</span>;
    const idx = Number(m[1]);
    const c = byIdx.get(idx);
    if (!c) return <span key={i}>{part}</span>;
    return (
      <a
        key={i}
        href={`${ARKIV_DATA_EXPLORER}?entityKey=${c.entityKey}`}
        target="_blank"
        rel="noopener noreferrer"
        title={`${c.snippet} · conf ${c.confidence}`}
        className="font-mono text-primary underline decoration-dotted underline-offset-2 hover:text-secondary"
      >
        [{idx}]
      </a>
    );
  });
}

function CitationList({ citations }: { citations: Citation[] }) {
  return (
    <ol className="mt-2 list-none space-y-1 border-t border-outline-variant/30 pt-2 font-mono text-[10px] text-on-surface-variant">
      {citations.map((c) => (
        <li key={c.index} className="flex items-start gap-2">
          <span className="text-primary">[{c.index}]</span>
          <span className="flex-1 truncate">{c.snippet}</span>
          <a
            href={`${ARKIV_DATA_EXPLORER}?entityKey=${c.entityKey}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-on-surface-variant hover:text-primary"
            title={c.entityKey}
          >
            ↗
          </a>
        </li>
      ))}
    </ol>
  );
}
