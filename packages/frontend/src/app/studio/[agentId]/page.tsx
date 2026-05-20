'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { getAgent, publishAgent, type Agent } from '@/lib/agents';
import { AGENT_BACKEND_URL } from '@/lib/contracts';

type Tab = 'overview' | 'knowledge' | 'earnings' | 'settings';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: 'dashboard' },
  { id: 'knowledge', label: 'Knowledge', icon: 'book_2' },
  { id: 'earnings', label: 'Earnings', icon: 'payments' },
  { id: 'settings', label: 'Settings', icon: 'tune' },
];

export default function StudioAgentPage() {
  const params = useParams<{ agentId: string }>();
  const agentId = params?.agentId;
  const { user } = usePrivy();
  const userAddress = user?.wallet?.address as `0x${string}` | undefined;
  const [agent, setAgent] = useState<Agent | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (agentId) getAgent(agentId).then(setAgent);
  }, [agentId]);

  async function handlePublish() {
    if (!agent || !userAddress) return;
    setBusy(true);
    const ok = await publishAgent(userAddress, Number(agent.id), agent.title, agent.tags);
    setMsg(ok ? '✓ Published to marketplace' : 'Publish failed');
    if (ok) setAgent({ ...agent, published: true });
    setBusy(false);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userAddress || !agent) return;
    setBusy(true);
    setMsg(null);
    const form = new FormData();
    form.append('file', file);
    form.append('brainId', String(agent.id));
    try {
      const r = await fetch(`${AGENT_BACKEND_URL}/upload`, {
        method: 'POST',
        headers: { 'x-wallet-address': userAddress },
        body: form,
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error ?? 'Upload failed');
      }
      setMsg(`✓ Uploaded ${file.name}`);
    } catch (err: any) {
      setMsg(err?.message ?? 'Upload failed');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  if (!agent) {
    return <div className="py-20 text-center text-on-surface-variant">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href="/studio"
          className="inline-flex items-center gap-1 text-xs text-on-surface-variant hover:text-primary"
        >
          <span className="material-symbols-outlined text-[14px]">arrow_back</span> Studio
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-headline text-3xl font-bold">{agent.title}</h1>
          <span
            className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
              agent.published
                ? 'border border-secondary/30 bg-secondary/10 text-secondary'
                : 'border border-tertiary/30 bg-tertiary/10 text-tertiary'
            }`}
          >
            {agent.published ? '✓ PUBLISHED' : '🔒 DRAFT'}
          </span>
        </div>
        <p className="font-mono text-xs text-on-surface-variant">
          Owner {agent.ownerAddress.slice(0, 8)}…{agent.ownerAddress.slice(-6)}
          {agent.tags.length > 0 && <span className="ml-3">· {agent.tags.map((t) => `#${t}`).join(' ')}</span>}
        </p>
      </div>

      <div className="scrollbar-none flex gap-1 overflow-x-auto rounded-full border border-outline-variant/30 bg-surface p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm transition-colors ${
              tab === t.id
                ? 'bg-primary text-on-primary'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {msg && (
        <div className="rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm text-on-surface-variant">
          {msg}
        </div>
      )}

      {tab === 'overview' && (
        <div className="rounded-xl border border-outline-variant/30 bg-surface p-5 max-w-md">
          <div className="font-mono text-[10px] uppercase text-on-surface-variant">Status</div>
          <div className="mt-1 font-headline text-2xl font-bold">
            {agent.published ? 'Live' : 'Draft'}
          </div>
          <button
            onClick={handlePublish}
            disabled={busy || agent.published}
            className="mt-4 w-full rounded-full bg-primary py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {agent.published ? 'Already live' : 'Publish to marketplace'}
          </button>
        </div>
      )}

      {tab === 'knowledge' && (
        <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-8 text-center">
          <span className="material-symbols-outlined mb-2 block text-4xl text-on-surface-variant">
            cloud_upload
          </span>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-primary px-5 py-2.5 font-medium text-on-primary">
            {busy ? 'Uploading…' : 'Upload .txt / .md / .csv'}
            <input
              type="file"
              accept=".txt,.md,.csv"
              onChange={handleUpload}
              className="hidden"
              disabled={busy}
            />
          </label>
          <p className="mt-3 font-mono text-[11px] text-on-surface-variant">
            🔒 Files are AES-encrypted before upload. Key wrapped via Fhenix CoFHE.
          </p>
        </div>
      )}

      {tab === 'earnings' && (
        <div className="rounded-xl border border-outline-variant/30 bg-surface p-6 text-center">
          <span className="material-symbols-outlined mb-2 block text-4xl text-on-surface-variant">
            payments
          </span>
          <p className="text-on-surface-variant">Earnings dashboard coming soon.</p>
          <p className="mt-1 font-mono text-xs text-on-surface-variant">
            Settlement via x402 + USDC on Base Sepolia.
          </p>
        </div>
      )}

      {tab === 'settings' && (
        <div className="space-y-4 rounded-xl border border-outline-variant/30 bg-surface p-6">
          <div>
            <div className="font-mono text-[10px] uppercase text-on-surface-variant">Agent ID</div>
            <div className="font-mono text-sm">{agent.id}</div>
          </div>
          <div className="rounded-lg border border-error/30 bg-error/5 p-4">
            <div className="font-mono text-xs uppercase text-error">Danger zone</div>
            <p className="mt-1 text-sm text-on-surface-variant">
              Archiving is not yet supported. Contact platform support to delete an agent.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
