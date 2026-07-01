'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import {
  listMyAgents,
  archiveBrain,
  restoreBrain,
  archiveAllMyAgents,
  listMyTasks,
  type Agent,
  type BuyerTask,
} from '@/lib/agents';
import { useActiveWallet } from '@/hooks/useActiveWallet';
import { AGENT_BACKEND_URL } from '@/lib/contracts';

/** Hidden assistant row. Combines two sources:
 *  - dashboard.archived_agents (v2 listings with rich metadata)
 *  - brains.published=false (legacy v1 brains; archived_at may be null)
 *  brain_id is the stable primary key for Hide/Restore actions. */
interface ArchivedAgent {
  brain_id: number;
  id: string | null;
  slug: string | null;
  title: string;
  archived_at: string | null;
}

type StudioTab = 'creator' | 'user';

export default function StudioPage() {
  const { authenticated, ready, login } = usePrivy();
  // Active wallet — single-tier post-Sui-removal (Privy EVM only). Stamping
  // the agent with the ACTIVE wallet keeps /studio identity-coherent:
  // ownership chip on the detail page matches the header pill.
  const { address } = useActiveWallet();
  const userAddress = address as `0x${string}` | undefined;
  // PRD-F: permit gate removed alongside FHE strip. Studio is wallet-gated;
  // every authenticated wallet can manage their own agents directly.
  const hasPermit = !!userAddress;
  const [agents, setAgents] = useState<Agent[]>([]);
  const [archivedAgents, setArchivedAgents] = useState<ArchivedAgent[]>([]);
  const [creditBalance, setCreditBalance] = useState<{
    seller_id: number;
    accrued_usdc: string;
    withdrawn_usdc: string;
    withdrawable_usdc: string;
    last_withdraw_at: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  // Tab state — URL-driven via ?tab=creator|user. Defaults are role-aware
  // (set after first dashboard fetch resolves so we know if user is a creator).
  const [tab, setTab] = useState<StudioTab>('creator');

  useEffect(() => {
    if (!userAddress) return;
    setLoading(true);
    // Defensive joined view (PRD-17 §1c): show every agent the connected
    // wallet owns — both v1 brains (via listMyAgents → /brains/mine) and
    // v2 marketplace listings (via /v3/marketplace/seller/dashboard). The
    // dashboard endpoint joins on `agents.seller_id`; the brain list joins
    // on `brains.owner_address`. Together they catch every ownership path
    // without an extra schema migration.
    Promise.all([
      listMyAgents(userAddress),
      fetch(`${AGENT_BACKEND_URL}/v3/marketplace/seller/dashboard`, {
        headers: { 'x-wallet-address': userAddress },
      })
        .then((r) => (r.ok ? r.json() : { agents: [] }))
        .catch(() => ({ agents: [] })),
    ])
      .then(([brainAgents, dash]) => {
        // Match by brain_id (numeric, stable across v1 brains and v2
        // marketplace listings). The dashboard endpoint returns brain_id +
        // agent UUID for every agent owned by the wallet — so every brain
        // surfaces with v3AgentId metadata where one exists.
        const dashAgents = (dash?.agents ?? []) as Array<{
          id?: string;
          brain_id?: number;
          slug?: string;
          kind?: string;
          earned_total?: string;
          calls_total?: number;
        }>;
        const dashByBrainId = new Map(
          dashAgents.filter((a) => a.brain_id != null).map((a) => [Number(a.brain_id), a]),
        );
        // PRD-22 — brain is the source of truth. A brain is "hidden" when
        // brains.published=false OR any agent wrapping it is archived.
        // Either signal moves the row out of the active list.
        const archivedBrainIds = new Set(
          ((dash?.archived_agents ?? []) as Array<{ brain_id?: number }>)
            .filter((a) => a.brain_id != null)
            .map((a) => Number(a.brain_id)),
        );
        const merged = brainAgents
          .filter((a) => a.published !== false && !archivedBrainIds.has(a.id))
          .map((a) => {
            const m = dashByBrainId.get(a.id);
            return m
              ? Object.assign({}, a, {
                  _kind: m.kind,
                  _earned: m.earned_total,
                  _calls: m.calls_total,
                  v3AgentId: m.id ?? a.v3AgentId,
                  slug: m.slug ?? a.slug,
                })
              : a;
          });
        // Hidden = (a) brains with archived agents (rich metadata via dash)
        //       + (b) brains where published=false but no archived agent
        //         (legacy v1 brains hidden via archive-all). Both restore
        //         through the same brain-keyed endpoint.
        const dashArchived = (dash?.archived_agents ?? []) as ArchivedAgent[];
        const dashArchivedByBrainId = new Map(
          dashArchived.filter((a) => a.brain_id != null).map((a) => [Number(a.brain_id), a]),
        );
        const hiddenBrains: ArchivedAgent[] = brainAgents
          .filter((a) => a.published === false || archivedBrainIds.has(a.id))
          .map((a) => {
            const m = dashArchivedByBrainId.get(a.id);
            return {
              brain_id: a.id,
              id: m?.id ?? null,
              slug: m?.slug ?? null,
              title: a.title || (m?.title ?? `Brain #${a.id}`),
              archived_at: m?.archived_at ?? null,
            };
          });
        setAgents(merged);
        setArchivedAgents(hiddenBrains);
        // PRD-G — credit_balance is null when the seller has no
        // accrual yet (no credit-debit hires) OR when the API flag is off.
        setCreditBalance((dash?.credit_balance as typeof creditBalance) ?? null);
      })
      .finally(() => setLoading(false));
  }, [userAddress]);

  // Tab routing — read ?tab= once on mount; default to 'user' when the
  // wallet owns nothing (active or hidden). Sellers default to 'creator'.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'creator' || t === 'user') {
      setTab(t);
      return;
    }
    if (!loading && agents.length === 0 && archivedAgents.length === 0) {
      setTab('user');
    }
  }, [loading, agents.length, archivedAgents.length]);

  function selectTab(next: StudioTab) {
    setTab(next);
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (next === 'creator') params.delete('tab'); else params.set('tab', next);
    window.history.replaceState({}, '', `/studio${params.toString() ? '?' + params.toString() : ''}`);
  }

  // ─── PRD-22 — brain-keyed soft archive / restore handlers ─────────────
  // Optimistic UI: move the row between active + hidden lists immediately;
  // both v1 legacy brains (no agent row) and v2 marketplace listings
  // resolve through the same brain-keyed endpoint pair.
  async function onHide(brainId: number, title: string) {
    if (!userAddress) return;
    const proceed = window.confirm(
      `Hide "${title}"? Buyer receipts stay visible. You can restore any time from the Hidden section below.`,
    );
    if (!proceed) return;
    setStatus(`Hiding "${title}"…`);
    try {
      await archiveBrain(brainId, userAddress);
      const hidden = agents.find((a) => a.id === brainId);
      setAgents((prev) => prev.filter((a) => a.id !== brainId));
      setArchivedAgents((prev) => [
        {
          brain_id: brainId,
          id: hidden?.v3AgentId ?? null,
          slug: hidden?.slug ?? null,
          title: hidden?.title ?? title,
          archived_at: new Date().toISOString(),
        },
        ...prev,
      ]);
      setStatus(`✓ Hid "${title}"`);
    } catch (err: any) {
      setStatus(err?.message ?? 'Hide failed');
    }
  }

  async function onRestore(brainId: number, title: string) {
    if (!userAddress) return;
    setStatus(`Restoring "${title}"…`);
    try {
      await restoreBrain(brainId, userAddress);
      setArchivedAgents((prev) => prev.filter((a) => a.brain_id !== brainId));
      // Re-fetch to pick up the live brain row + (if any) agent metadata.
      const fresh = await listMyAgents(userAddress);
      setAgents(fresh.filter((a) => a.published !== false));
      setStatus(`✓ Restored "${title}"`);
    } catch (err: any) {
      setStatus(err?.message ?? 'Restore failed');
    }
  }

  async function onHideAll() {
    if (!userAddress) return;
    if (agents.length === 0) return;
    const proceed = window.confirm(
      `Hide all ${agents.length} of your assistants? Buyer receipts stay visible. You can restore individual assistants any time.`,
    );
    if (!proceed) return;
    setStatus('Hiding all assistants…');
    try {
      const r = await archiveAllMyAgents(userAddress);
      setArchivedAgents((prev) => [
        ...agents.map<ArchivedAgent>((a) => ({
          brain_id: a.id,
          id: a.v3AgentId ?? null,
          slug: a.slug ?? null,
          title: a.title,
          archived_at: new Date().toISOString(),
        })),
        ...prev,
      ]);
      setAgents([]);
      const total = (r.archived_count ?? 0) + ((r as { unpublished_brains?: number }).unpublished_brains ?? 0);
      setStatus(`✓ Hid ${total} assistants`);
    } catch (err: any) {
      setStatus(err?.message ?? 'Hide-all failed');
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
            Train, manage, and publish your AI agents.
          </p>
        </div>
        <Link
          href="/seller/onboard?return=/studio"
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-on-primary hover:opacity-90"
        >
          <span className="material-symbols-outlined text-[18px]">rocket_launch</span>
          + New agent
        </Link>
      </div>
      {/* Tab strip — Creator | User. URL-driven via ?tab=user|creator. */}
      <div className="flex gap-1 border-b border-outline-variant/30">
        {(['creator', 'user'] as const).map((t) => {
          const active = tab === t;
          const label = t === 'creator' ? 'Creator' : 'User';
          return (
            <button
              key={t}
              type="button"
              onClick={() => selectTab(t)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {tab === 'creator' && (
        <>
          <EarningsTile userAddress={userAddress} agents={agents} />
          <SellerCreditTile
            userAddress={userAddress}
            balance={creditBalance}
            onWithdrawn={() => {
              // Refetch the dashboard so the tile reflects the new
              // withdrawn + withdrawable values without a hard reload.
              if (!userAddress) return;
              fetch(`${AGENT_BACKEND_URL}/v3/marketplace/seller/dashboard`, {
                headers: { 'x-wallet-address': userAddress },
              })
                .then((r) => (r.ok ? r.json() : null))
                .then((d) =>
                  setCreditBalance((d?.credit_balance as typeof creditBalance) ?? null),
                )
                .catch(() => {/* silent */});
            }}
          />

          {!hasPermit ? (
            // PRD-F: Permit-gate removed. Show a simple sign-in prompt.
            <section className="rounded-xl border border-dashed border-outline-variant/30 bg-surface p-8 text-center">
              <p className="text-sm text-on-surface-variant">
                Connect your wallet to manage your agents.
              </p>
            </section>
          ) : (
            <>
              {/* Create-new — unified with /seller/onboard. */}
              <section className="rounded-xl border border-dashed border-outline-variant/30 bg-surface p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-headline text-lg font-semibold">Create a new assistant</h2>
                    <p className="text-sm text-on-surface-variant">
                      One human, many assistants. Publish in under a minute.
                    </p>
                  </div>
                  <Link
                    href="/seller/onboard?return=/studio"
                    className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-on-primary hover:opacity-90"
                  >
                    Open the publish wizard →
                  </Link>
                </div>
              </section>

              {/* Active agent list */}
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-headline text-lg font-semibold">
                    My assistants ({agents.length})
                  </h2>
                  <div className="flex items-center gap-3">
                    {status && <span className="text-xs text-on-surface-variant">{status}</span>}
                    {agents.length > 0 && (
                      <button
                        type="button"
                        onClick={onHideAll}
                        className="text-xs text-on-surface-variant underline-offset-2 hover:text-error hover:underline"
                      >
                        Hide all my assistants
                      </button>
                    )}
                  </div>
                </div>

                {loading ? (
                  <div className="py-12 text-center text-on-surface-variant">Loading…</div>
                ) : agents.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-10 text-center">
                    <p className="text-on-surface-variant">You haven&apos;t created an assistant yet.</p>
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
                        <Link href={`/agent/${a.id}`} className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-primary">smart_toy</span>
                            <div className="min-w-0">
                              <div className="truncate font-headline font-semibold">{a.title}</div>
                              <div className="font-mono text-[11px] text-on-surface-variant">
                                {a.slug ? '✓ Published' : '🔒 Private draft'}
                              </div>
                            </div>
                          </div>
                        </Link>
                        {a.slug && (
                          <Link
                            href={`/agent/${a.id}`}
                            target="_blank"
                            rel="noreferrer"
                            title="Open public detail page (what users see)"
                            className="rounded-full border border-secondary/30 bg-secondary/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-secondary transition-colors hover:bg-secondary/20"
                          >
                            public ↗
                          </Link>
                        )}
                        <label className="cursor-pointer rounded-full border border-outline-variant/40 px-3 py-1.5 text-xs text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary">
                          Upload
                          <input
                            type="file"
                            accept=".txt,.md,.csv"
                            onChange={(e) => handleUpload(e, a.id)}
                            className="hidden"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => onHide(a.id, a.title)}
                          title="Hide this assistant from the marketplace. Receipts are preserved; you can restore any time."
                          className="rounded-full border border-outline-variant/40 px-2 py-1.5 text-xs text-on-surface-variant transition-colors hover:border-error/40 hover:text-error"
                        >
                          <span className="material-symbols-outlined text-[16px]" aria-hidden>
                            visibility_off
                          </span>
                          <span className="sr-only">Hide</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Hidden assistants — collapsible. Always rendered (even when
                  empty) so creators learn the affordance exists. */}
              <details className="rounded-xl border border-outline-variant/30 bg-surface-container-low">
                <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-on-surface-variant">
                  Hidden assistants ({archivedAgents.length})
                </summary>
                <div className="border-t border-outline-variant/20 p-5">
                  {archivedAgents.length === 0 ? (
                    <p className="text-sm text-on-surface-variant">
                      Nothing hidden. Use the
                      {' '}
                      <span className="material-symbols-outlined align-middle text-[14px]" aria-hidden>
                        visibility_off
                      </span>
                      {' '}
                      icon on any assistant above to hide it. You can restore any time.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {archivedAgents.map((a) => (
                        <li
                          key={a.brain_id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-outline-variant/20 bg-surface px-4 py-2.5"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium text-on-surface">{a.title}</div>
                            <div className="font-mono text-[11px] text-on-surface-variant">
                              hidden{a.archived_at ? ` ${new Date(a.archived_at).toLocaleDateString()}` : ''}
                              {a.slug ? ` · ${a.slug}` : ''}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => onRestore(a.brain_id, a.title)}
                            className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs text-primary hover:bg-primary/20"
                          >
                            Restore
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </details>
            </>
          )}
        </>
      )}

      {tab === 'user' && <UserTabBody walletAddress={userAddress} />}
    </div>
  );
}

// ─── PRD-21 — UserTabBody (buyer task history) ────────────────────────────
//
// Renders the connected wallet's full receipt history. Auth-derived: the
// endpoint takes no `:address`, only `req.user.address`, so a stale tab
// can't surface someone else's tasks.

function UserTabBody({ walletAddress }: { walletAddress: `0x${string}` | undefined }) {
  const [data, setData] = useState<{
    tasks: BuyerTask[];
    task_count: number;
    total_spent_usdc: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!walletAddress) return;
    setLoading(true);
    listMyTasks(walletAddress, { limit: 100 })
      .then((r) => setData(r))
      .catch((e) => setErr(e?.message ?? String(e)))
      .finally(() => setLoading(false));
  }, [walletAddress]);

  if (!walletAddress) {
    return (
      <p className="py-12 text-center text-sm text-on-surface-variant">Sign in to view your tasks.</p>
    );
  }

  if (loading && !data) {
    return <div className="py-12 text-center text-on-surface-variant">Loading your tasks…</div>;
  }

  if (err) {
    return (
      <p role="alert" className="text-sm text-amber-500">
        Couldn&apos;t load tasks ({err}).
      </p>
    );
  }

  const totalSpent = Number(data?.total_spent_usdc ?? '0');
  const taskCount = data?.task_count ?? 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <KpiCard label="Total spent" value={`$${totalSpent.toFixed(2)}`} hint="all-time" />
        <KpiCard label="Tasks completed" value={String(taskCount)} hint={taskCount === 1 ? 'task' : 'tasks'} />
      </div>

      {taskCount === 0 ? (
        <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-10 text-center">
          <p className="text-on-surface-variant">You haven&apos;t hired any assistants yet.</p>
          <Link href="/marketplace" className="mt-2 inline-block text-sm text-primary hover:underline">
            Browse the marketplace →
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-outline-variant/30">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-surface-container-low text-xs uppercase text-on-surface-variant">
              <tr>
                <th className="px-4 py-2">Assistant</th>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2 text-right">Paid</th>
                <th className="px-4 py-2">Receipt</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(data?.tasks ?? []).map((t) => (
                <tr key={t.id} className="border-t border-outline-variant/20">
                  <td className="px-4 py-3">
                    <Link href={`/agent/${t.agent_id}`} className="text-primary hover:underline">
                      {t.agent_title}
                    </Link>
                    <div className="font-mono text-[10px] text-on-surface-variant">/{t.slug}</div>
                  </td>
                  <td className="px-4 py-3 text-on-surface-variant" title={t.created_at}>
                    {relTime(t.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    ${Number(t.amount_usdc).toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={receiptUrl(t.network, t.tx_hash)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      View receipt ↗
                    </a>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/agent/${t.agent_id}`}
                      className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs text-primary hover:bg-primary/20"
                    >
                      Use again
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface p-4">
      <div className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">{label}</div>
      <div className="mt-1 font-headline text-2xl font-semibold text-on-surface">{value}</div>
      {hint && <div className="mt-1 text-xs text-on-surface-variant">{hint}</div>}
    </div>
  );
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const delta = Math.max(0, Date.now() - t);
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  if (delta < 7 * 86_400_000) return `${Math.floor(delta / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function receiptUrl(network: string, txHash: string): string {
  if (!txHash || txHash.startsWith('mock-') || txHash.startsWith('free-')) return '#';
  if (network === 'base-sepolia') return `https://sepolia.basescan.org/tx/${txHash}`;
  return `https://sepolia.arbiscan.io/tx/${txHash}`;
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

function EarningsTile({ userAddress, agents }: { userAddress: `0x${string}` | undefined; agents: Agent[] }) {
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

  // Map slug → brainId so receipt rows can deep-link into /agent/[id] (the
  // canonical bundle page). Falls back to a non-link span when no match.
  const slugToBrainId = new Map<string, number>();
  for (const a of agents) if (a.slug) slugToBrainId.set(a.slug, a.id);

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
          {(data.paidCalls ?? []).slice(0, 3).map((p) => {
            const brainId = slugToBrainId.get(p.slug);
            return (
              <li key={p.txHash} className="flex items-center justify-between text-xs">
                {brainId !== undefined ? (
                  <Link href={`/agent/${brainId}`} className="font-mono hover:text-primary">
                    /{p.slug}
                  </Link>
                ) : (
                  <span className="font-mono">/{p.slug}</span>
                )}
                <span className="font-mono">${p.amountUsdc}</span>
                <a href={p.explorerUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                  tx ↗
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

// ─── SellerCreditTile (PRD-G) ───────────────────────────────────────────
//
// Renders accrued / withdrawn / withdrawable from
// /v3/marketplace/seller/dashboard.credit_balance + a single Withdraw
// button that POSTs /v3/marketplace/seller/withdraw. The button is
// disabled below the $5 minimum + during cooldown.
//
// SRP: this tile owns the seller cash-out UI. Balance reads live on the
// parent's dashboard fetch (no extra round-trip on mount). Inline
// sub-component per the page's "no new files" convention (see EarningsTile).

interface SellerCreditBalance {
  seller_id: number;
  accrued_usdc: string;
  withdrawn_usdc: string;
  withdrawable_usdc: string;
  last_withdraw_at: string | null;
}

function SellerCreditTile({
  userAddress,
  balance,
  onWithdrawn,
}: {
  userAddress: `0x${string}` | undefined;
  balance: SellerCreditBalance | null;
  onWithdrawn: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);

  // Hide the tile entirely when the API didn't return credit_balance
  // (flag off OR no seller row OR no accrual yet). Sellers see the
  // standard EarningsTile in either case.
  if (!balance) return null;

  const withdrawable = Number(balance.withdrawable_usdc);
  const accrued = Number(balance.accrued_usdc);
  const withdrawn = Number(balance.withdrawn_usdc);
  const minWithdraw = 5;
  const cooldownOk =
    !balance.last_withdraw_at ||
    (Date.now() - new Date(balance.last_withdraw_at).getTime()) / 1000 > 300;
  const canWithdraw = withdrawable >= minWithdraw && cooldownOk && !busy;

  async function withdraw() {
    if (!userAddress) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${AGENT_BACKEND_URL}/v3/marketplace/seller/withdraw`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-wallet-address': userAddress },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (j.error === 'cooldown_active') {
          setErr(`Cooldown — try again in ${j.retry_after_seconds}s.`);
        } else if (j.error === 'below_minimum') {
          setErr(`Need at least $${j.minimum_usdc} to withdraw.`);
        } else if (j.error === 'payout_not_configured') {
          setErr('Payout wallet not configured on the API. Contact platform admin.');
        } else {
          setErr(j.detail ?? j.error ?? `HTTP ${r.status}`);
        }
        return;
      }
      setLastTx(j.tx_hash);
      onWithdrawn();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-secondary/30 bg-secondary/5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-on-surface-variant">
            Credit earnings (PRD-G)
          </div>
          <div className="mt-1 font-headline text-3xl font-bold">
            ${withdrawable.toFixed(2)}
            <span className="ml-2 font-mono text-xs text-on-surface-variant">withdrawable</span>
          </div>
          <div className="mt-1 font-mono text-[11px] text-on-surface-variant">
            accrued ${accrued.toFixed(2)} · withdrawn ${withdrawn.toFixed(2)}
            {balance.last_withdraw_at && (
              <> · last {new Date(balance.last_withdraw_at).toLocaleString()}</>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={withdraw}
          disabled={!canWithdraw}
          className="rounded-full bg-secondary px-4 py-2 text-sm font-medium text-on-secondary transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
          title={
            !cooldownOk
              ? 'Cooldown active (5 min between withdrawals).'
              : withdrawable < minWithdraw
              ? `Min withdraw $${minWithdraw}`
              : busy
              ? 'Withdrawing…'
              : 'Send USDC to your account to top up'
          }
        >
          {busy ? 'Withdrawing…' : `Withdraw $${withdrawable.toFixed(2)}`}
        </button>
      </div>
      {lastTx && (
        <p className="mt-3 font-mono text-[11px] text-on-surface-variant">
          ✓ paid out —{' '}
          <Link
            href={`https://sepolia.arbiscan.io/tx/${lastTx}`}
            target="_blank"
            rel="noopener"
            className="text-primary hover:underline"
          >
            {lastTx.slice(0, 10)}…{lastTx.slice(-6)}
          </Link>
        </p>
      )}
      {err && (
        <p role="alert" className="mt-3 text-sm text-amber-500">
          {err}
        </p>
      )}
    </section>
  );
}
