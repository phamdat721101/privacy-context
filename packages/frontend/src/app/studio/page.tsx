'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { listMyAgents, createAgent, type Agent } from '@/lib/agents';
import { usePermit } from '@/hooks/usePermit';
import { PermitManager } from '@/components/PermitManager';
import { AGENT_BACKEND_URL } from '@/lib/contracts';

export default function StudioPage() {
  const { authenticated, ready, user, login } = usePrivy();
  const userAddress = user?.wallet?.address as `0x${string}` | undefined;
  const {
    permitState,
    reason,
    authorize,
    revoke,
    loading: permitLoading,
    error: permitError,
  } = usePermit(userAddress);
  const hasPermit = !!permitState.serializedPermit;
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!userAddress) return;
    setLoading(true);
    listMyAgents(userAddress)
      .then(setAgents)
      .finally(() => setLoading(false));
  }, [userAddress]);

  async function handleCreate() {
    if (!userAddress || !newTitle.trim()) return;
    setCreating(true);
    setStatus(null);
    try {
      const agent = await createAgent(userAddress, newTitle.trim());
      if (agent) {
        setAgents((prev) => [agent, ...prev]);
        setNewTitle('');
        setStatus(`✓ Created "${agent.title}"`);
      } else {
        setStatus('Failed to create agent');
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>, agentId: number) {
    const file = e.target.files?.[0];
    if (!file || !userAddress) return;
    setStatus(`Uploading ${file.name}…`);
    const form = new FormData();
    form.append('file', file);
    form.append('brainId', String(agentId));
    try {
      const r = await fetch(`${AGENT_BACKEND_URL}/upload`, {
        method: 'POST',
        headers: { 'x-wallet-address': userAddress },
        body: form,
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error ?? `Upload failed (${r.status})`);
      }
      setStatus(`✓ Uploaded to agent #${agentId}`);
    } catch (err: any) {
      setStatus(err?.message ?? 'Upload failed');
    } finally {
      e.target.value = '';
    }
  }

  if (!ready) return null;
  if (!authenticated) {
    return (
      <div className="space-y-3 py-20 text-center">
        <h1 className="font-headline text-2xl font-bold">Connect to open Studio</h1>
        <p className="text-on-surface-variant">Studio is for agent owners.</p>
        <button onClick={login} className="rounded-full bg-primary px-5 py-3 text-on-primary">
          Connect wallet
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <h1 className="font-headline text-3xl font-bold">Studio</h1>
          <p className="text-on-surface-variant">
            Train, manage, and publish your encrypted AI agents.
          </p>
        </div>
        <Link
          href="/studio/publish"
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-on-primary hover:opacity-90"
        >
          <span className="material-symbols-outlined text-[18px]">rocket_launch</span>
          + New paid API
        </Link>
      </div>
      <EarningsTile userAddress={userAddress} />

      {!hasPermit ? (
        // Onboarding gate: login → permit → create. The PermitManager is the
        // only deliberate step between authenticated wallet and creator UI.
        // After authorize() succeeds, usePermit refreshes and this branch flips
        // to the creator UI on the next render.
        <PermitManager
          permitState={permitState}
          authorize={authorize}
          revoke={revoke}
          loading={permitLoading}
          error={permitError}
          reason={reason}
        />
      ) : (
        <>
          {/* Create new agent */}
          <section className="space-y-4 rounded-xl border border-outline-variant/30 bg-surface p-6">
        <h2 className="font-headline text-lg font-semibold">Create new agent</h2>
        <div className="flex flex-col gap-3 md:flex-row">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="e.g. Solidity Security Mentor"
            className="flex-1 rounded-full border border-outline-variant/40 bg-surface-container-low px-4 py-2.5 text-on-surface placeholder:text-on-surface-variant focus:border-primary/60 focus:outline-none"
          />
          <button
            onClick={handleCreate}
            disabled={!newTitle.trim() || creating}
            className="rounded-full bg-primary px-5 py-2.5 font-medium text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create agent'}
          </button>
        </div>
      </section>

      {/* Agent list */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-headline text-lg font-semibold">My agents ({agents.length})</h2>
          {status && <span className="text-xs text-on-surface-variant">{status}</span>}
        </div>

        {loading ? (
          <div className="py-12 text-center text-on-surface-variant">Loading…</div>
        ) : agents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-10 text-center">
            <p className="text-on-surface-variant">You haven&apos;t created an agent yet.</p>
            <p className="mt-2 text-xs text-on-surface-variant">
              Use the form above to create your first one.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {agents.map((a) => (
              <div
                key={a.id}
                className="encryption-glow flex items-center justify-between gap-3 rounded-xl border border-outline-variant/30 bg-surface p-4"
              >
                <Link href={`/studio/${a.id}`} className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">smart_toy</span>
                    <div className="min-w-0">
                      <div className="truncate font-headline font-semibold">{a.title}</div>
                      <div className="font-mono text-[11px] text-on-surface-variant">
                        {a.published ? '✓ Published' : '🔒 Private draft'}
                      </div>
                    </div>
                  </div>
                </Link>
                <label className="cursor-pointer rounded-full border border-outline-variant/40 px-3 py-1.5 text-xs text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary">
                  Upload
                  <input
                    type="file"
                    accept=".txt,.md,.csv"
                    onChange={(e) => handleUpload(e, a.id)}
                    className="hidden"
                  />
                </label>
              </div>
            ))}
          </div>
        )}
      </section>
        </>
      )}
    </div>
  );
}

// ─── EarningsTile ──────────────────────────────────────────────────────────
//
// SRP: surfaces real settled USDC + paid_calls totals from /brains/earnings/.
// Co-located here because it's the only page that uses it; promote to its
// own file if a second consumer appears.

interface EarningsData {
  settledTotalUsdc?: number;
  settledCallCount?: number;
  paidCalls?: Array<{
    slug: string;
    amountUsdc: string;
    txHash: string;
    explorerUrl: string;
    method: string;
    at: string;
  }>;
}

function EarningsTile({ userAddress }: { userAddress: `0x${string}` | undefined }) {
  const [data, setData] = useState<EarningsData | null>(null);
  useEffect(() => {
    if (!userAddress) return;
    let cancelled = false;
    const load = () =>
      fetch(`${AGENT_BACKEND_URL}/brains/earnings/${userAddress}`, {
        headers: { 'x-wallet-address': userAddress },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => !cancelled && setData(d))
        .catch(() => {/* silent */});
    load();
    const t = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [userAddress]);

  if (!data || (data.settledCallCount ?? 0) === 0) return null;

  return (
    <section className="grid gap-3 md:grid-cols-2">
      <div className="rounded-xl border border-secondary/30 bg-secondary/5 p-5">
        <div className="text-xs uppercase tracking-wider text-on-surface-variant">Settled (24 h)</div>
        <div className="mt-1 font-headline text-3xl font-bold">
          ${(data.settledTotalUsdc ?? 0).toFixed(4)}
          <span className="ml-2 font-mono text-xs text-on-surface-variant">USDC</span>
        </div>
        <div className="mt-1 text-xs text-on-surface-variant">{data.settledCallCount} paid calls</div>
      </div>
      <div className="rounded-xl border border-outline-variant/30 bg-surface p-5">
        <div className="text-xs uppercase tracking-wider text-on-surface-variant">Latest receipts</div>
        <ul className="mt-2 space-y-1.5">
          {(data.paidCalls ?? []).slice(0, 3).map((p) => (
            <li key={p.txHash} className="flex items-center justify-between text-xs">
              <span className="font-mono">/{p.slug}</span>
              <span className="font-mono">${p.amountUsdc}</span>
              <a href={p.explorerUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                tx ↗
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
