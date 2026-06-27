'use client';

/**
 * /inbox — PRD-2 unified buyer inbox.
 *
 * Chronological merge of paid calls + thread messages + async task updates,
 * all scoped to the connected wallet. Filter chips for the 3 modes.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import { useActiveWallet } from '@/hooks/useActiveWallet';

type InboxItem =
  | {
      item_type: 'message';
      id: string;
      thread_id: string;
      sender_type: 'buyer' | 'agent' | 'operator' | 'system';
      sender_id: string;
      mode: 'm1' | 'm2' | 'm3' | 'm4';
      body: string;
      tee_attestation_hash: string;
      created_at: string;
      agent_slug?: string | null;
    }
  | {
      item_type: 'task_update';
      task_id: string;
      thread_id: string | null;
      agent_id: string;
      status: 'pending' | 'running' | 'complete' | 'failed';
      preview: string;
      created_at: string;
    }
  | {
      item_type: 'paid_call';
      paid_call_id: string;
      agent_id: string;
      slug: string;
      amount_usdc: string;
      method: string;
      created_at: string;
    };

type Filter = 'all' | 'messages' | 'tasks' | 'calls';

const FILTER_LABELS: Record<Filter, string> = {
  all: 'All',
  messages: 'Messages',
  tasks: 'Async tasks',
  calls: 'Paid calls',
};

export default function InboxPage() {
  const { address } = useActiveWallet();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const r = await fetch(`${AGENT_BACKEND_URL}/v3/inbox?limit=50`, {
          headers: { 'x-wallet-address': address },
        });
        if (r.status === 404) {
          if (!cancelled) setErr('Communication pipeline not enabled on this deploy.');
          return;
        }
        if (!r.ok) throw new Error(`status ${r.status}`);
        const body = (await r.json()) as { items: InboxItem[] };
        if (!cancelled) {
          setItems(body.items ?? []);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    // SSE — refresh on every push event.
    const url = new URL(`${AGENT_BACKEND_URL}/v3/inbox/stream`);
    url.searchParams.set('wallet', address);
    const es = new EventSource(url.toString());
    es.onmessage = () => load();
    es.onerror = () => es.close();

    return () => {
      cancelled = true;
      es.close();
    };
  }, [address]);

  const filtered = useMemo(
    () =>
      items.filter((i) => {
        if (filter === 'all') return true;
        if (filter === 'messages') return i.item_type === 'message';
        if (filter === 'tasks') return i.item_type === 'task_update';
        if (filter === 'calls') return i.item_type === 'paid_call';
        return true;
      }),
    [items, filter],
  );

  if (!address) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-2xl font-bold">Inbox</h1>
        <p className="mt-4 text-gray-600">Sign in to see your messages, async tasks, and recent calls.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Inbox</h1>
        <span className="text-xs text-gray-500">{filtered.length} item(s)</span>
      </header>

      <nav className="mt-4 flex gap-2 text-xs">
        {(Object.keys(FILTER_LABELS) as Filter[]).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={
              'rounded-full border px-3 py-1 ' +
              (filter === k ? 'border-black bg-black text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50')
            }
          >
            {FILTER_LABELS[k]}
          </button>
        ))}
      </nav>

      {err && <p className="mt-6 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{err}</p>}

      <ul className="mt-6 divide-y divide-gray-100">
        {filtered.map((item, idx) => (
          <li key={idx} className="py-4">
            {item.item_type === 'message' && <MessageRow item={item} />}
            {item.item_type === 'task_update' && <TaskRow item={item} />}
            {item.item_type === 'paid_call' && <PaidCallRow item={item} />}
          </li>
        ))}
        {loading && filtered.length === 0 && <li className="py-8 text-center text-sm text-gray-500">Loading…</li>}
        {!loading && filtered.length === 0 && (
          <li className="py-12 text-center text-sm text-gray-500">No items yet.</li>
        )}
      </ul>
    </main>
  );
}

function MessageRow({ item }: { item: Extract<InboxItem, { item_type: 'message' }> }) {
  return (
    <Link href={`/messages/${item.thread_id}`} className="flex items-baseline justify-between gap-4 hover:opacity-80">
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase text-gray-500">
          {item.sender_type} · mode {item.mode} {item.agent_slug ? `· ${item.agent_slug}` : ''}
        </p>
        <p className="mt-1 truncate text-sm text-gray-900">{item.body}</p>
      </div>
      <time className="shrink-0 text-xs text-gray-500">{new Date(item.created_at).toLocaleString()}</time>
    </Link>
  );
}

function TaskRow({ item }: { item: Extract<InboxItem, { item_type: 'task_update' }> }) {
  const colorClass =
    item.status === 'complete' ? 'text-green-700' :
    item.status === 'failed' ? 'text-red-700' :
    'text-blue-700';
  return (
    <div className="flex items-baseline justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className={`text-xs uppercase ${colorClass}`}>Async task · {item.status}</p>
        <p className="mt-1 truncate text-sm text-gray-900">{item.preview || 'pending'}</p>
      </div>
      <time className="shrink-0 text-xs text-gray-500">{new Date(item.created_at).toLocaleString()}</time>
    </div>
  );
}

function PaidCallRow({ item }: { item: Extract<InboxItem, { item_type: 'paid_call' }> }) {
  return (
    <Link href={`/agent/${item.agent_id}`} className="flex items-baseline justify-between gap-4 hover:opacity-80">
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase text-gray-500">paid call · {item.method}</p>
        <p className="mt-1 truncate text-sm text-gray-900">
          {item.slug} — ${Number(item.amount_usdc).toFixed(3)} USDC
        </p>
      </div>
      <time className="shrink-0 text-xs text-gray-500">{new Date(item.created_at).toLocaleString()}</time>
    </Link>
  );
}
