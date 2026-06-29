'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { usePrivyEvmAddress } from '@/hooks/useActiveWallet';
import { useCredits } from '@/hooks/useCredits';
import { TopUpModal } from '@/components/TopUpModal';
import {
  AGENT_BACKEND_URL,
  BRAIN_KEY_VAULT_ADDRESS,
  KNOWLEDGE_REGISTRY_ADDRESS,
  SUBSCRIPTION_CONTROLLER_ADDRESS,
} from '@/lib/contracts';

const CONTRACTS = [
  { name: 'BrainKeyVault', address: BRAIN_KEY_VAULT_ADDRESS },
  { name: 'KnowledgeBaseRegistry', address: KNOWLEDGE_REGISTRY_ADDRESS },
  { name: 'SubscriptionController', address: SUBSCRIPTION_CONTROLLER_ADDRESS },
];

/**
 * Settings — account, encryption, contracts.
 *
 * Single-tier post-Sui-removal: every brain is encrypted with Fhenix CoFHE
 * on Arbitrum. The PermitManager handles the encryption authorization;
 * the contracts panel surfaces the on-chain addresses for the curious.
 */
export default function SettingsPage() {
  const { authenticated, ready, login, logout } = usePrivy();
  const userAddress = usePrivyEvmAddress();

  if (!ready) return null;
  if (!authenticated) {
    return (
      <div className="space-y-3 py-20 text-center">
        <h1 className="font-headline text-2xl font-bold">Sign in to manage settings</h1>
        <button onClick={login} className="rounded-full bg-primary px-5 py-3 text-on-primary">
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-headline text-3xl font-bold">Settings</h1>
        <p className="text-on-surface-variant">Account and on-chain receipts.</p>
      </div>

      <section className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface p-6">
        <h2 className="font-headline text-lg font-semibold">Account</h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-xs text-on-surface-variant">Address</div>
            <div className="truncate font-mono text-sm">{userAddress}</div>
          </div>
          <button
            onClick={logout}
            className="rounded-full border border-outline-variant/40 px-4 py-2 text-sm text-error transition-colors hover:border-error/40"
          >
            Sign out
          </button>
        </div>
      </section>

      <MyActivitySection wallet={userAddress} />

      <CreditsSection wallet={userAddress} />

      <section className="space-y-3">
        <h2 className="font-headline text-lg font-semibold">Contracts (Arbitrum Sepolia)</h2>
        <div className="overflow-hidden rounded-xl border border-outline-variant/30 bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-container-high text-left font-mono text-[10px] uppercase text-on-surface-variant">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Address</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {CONTRACTS.map((c) => (
                <tr key={c.name} className="border-t border-outline-variant/20">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-on-surface-variant">{c.address || '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {c.address && (
                      <Link
                        href={`https://sepolia.arbiscan.io/address/${c.address}`}
                        target="_blank"
                        rel="noopener"
                        className="text-xs text-primary hover:underline"
                      >
                        View ↗
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ─── My activity — re-homed dashboard widget ────────────────────────────

interface EarningsResponse {
  wallet: string;
  pricePerQueryUsdc: number;
  totalQueries: number;
  totalUsdc: number;
  settledTotalUsdc: number;
  settledCallCount: number;
  brains: Array<{ id: number; title: string; queryCount: number; earnedUsdc: number; lastAt: string | null }>;
  receipts: Array<{ brainId: number; brainTitle: string; agentAddress: string; amount: string; currency: string; at: string }>;
  paidCalls: Array<{ slug: string; buyer: string; amountUsdc: string; txHash: string; network: string; method: string; explorerUrl: string; at: string }>;
}

function MyActivitySection({ wallet }: { wallet: string | undefined }) {
  const [data, setData] = useState<EarningsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!wallet) return;
    setLoading(true);
    fetch(`${AGENT_BACKEND_URL}/brains/earnings/${wallet}`, {
      headers: { 'x-wallet-address': wallet },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as EarningsResponse;
      })
      .then(setData)
      .catch((e) => setErr(e?.message ?? String(e)))
      .finally(() => setLoading(false));
  }, [wallet]);

  if (!wallet) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h2 className="font-headline text-lg font-semibold">My activity</h2>
          <p className="text-sm text-on-surface-variant">
            Cash-flow from your published brains. Live counts from{' '}
            <code className="font-mono text-xs">paid_calls</code>.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 font-mono text-[11px] uppercase text-primary hover:underline"
        >
          View full dashboard
          <span className="material-symbols-outlined text-[14px]" aria-hidden>arrow_forward</span>
        </Link>
      </div>

      {loading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} aria-hidden className="h-24 animate-pulse rounded-xl border border-outline-variant/20 bg-surface-container-low" />
          ))}
        </div>
      )}

      {err && !loading && (
        <p role="alert" className="text-sm text-amber-500">Couldn&apos;t load activity ({err}).</p>
      )}

      {data && !loading && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Total earned (settled)" value={`$${data.settledTotalUsdc.toFixed(4)}`} hint={`${data.settledCallCount} on-chain calls`} />
            <KpiCard label="Lifetime queries" value={String(data.totalQueries)} hint={`@ $${data.pricePerQueryUsdc} avg`} />
            <KpiCard label="Brains published" value={String(data.brains.length)} hint={data.brains.length ? 'live in catalog' : 'none yet'} />
            <KpiCard label="Recent receipts" value={String(data.receipts.length + data.paidCalls.length)} hint="last 50 each" />
          </div>

          {data.brains.length === 0 ? (
            <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-6 text-center">
              <p className="text-on-surface-variant">No brains published yet.</p>
              <Link href="/seller/onboard" className="mt-2 inline-block text-sm text-primary hover:underline">
                Publish your first agent →
              </Link>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-outline-variant/30 bg-surface">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-surface-variant/40">
                  <tr>
                    <th className="px-4 py-2 font-medium">Brain</th>
                    <th className="px-4 py-2 text-right font-medium">Queries</th>
                    <th className="px-4 py-2 text-right font-medium">Earned (USDC)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.brains.slice(0, 5).map((b) => (
                    <tr key={b.id} className="border-t border-outline-variant/20">
                      <td className="px-4 py-2">
                        <Link href={`/agent/${b.id}`} className="text-primary hover:underline">
                          {b.title || `Brain #${b.id}`}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs">{b.queryCount}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs">${b.earnedUsdc.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
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

// ─── CreditsSection (PRD-G) ─────────────────────────────────────────────
//
// Surfaces the buyer's credit balance + history + a discoverable Top-up
// button. Hidden entirely when the API reports `credit system disabled`
// (404 on /v3/credits/me, gated by FEATURE_CREDIT_SYSTEM).
//
// SRP: this component renders. Balance reads live in useCredits; purchases
// live in TopUpModal. No duplication of payment logic here.

interface LedgerRow {
  id: number;
  kind: 'welcome' | 'purchase' | 'spend' | 'refund' | 'payout';
  amount_usdc: string;
  agent_id: string | null;
  tx_hash: string | null;
  created_at: string;
}

const KIND_LABEL: Record<LedgerRow['kind'], string> = {
  welcome: 'Welcome bonus',
  purchase: 'Top-up',
  spend: 'Agent hire',
  refund: 'Refund',
  payout: 'Payout',
};

function CreditsSection({ wallet }: { wallet: `0x${string}` | undefined }) {
  const credits = useCredits();
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [history, setHistory] = useState<LedgerRow[] | null>(null);

  useEffect(() => {
    if (!wallet || !credits.enabled) return;
    fetch(`${AGENT_BACKEND_URL}/v3/credits/history?limit=10`, {
      headers: { 'x-wallet-address': wallet },
    })
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((j) => setHistory(j.rows ?? []))
      .catch(() => setHistory([]));
  }, [wallet, credits.enabled, credits.balance]);

  if (!credits.enabled) return null;

  return (
    <section className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-headline text-lg font-semibold">Credits</h2>
          <p className="text-sm text-on-surface-variant">
            1 credit = $1 USDC. Pay once, run agents until your balance runs out.
          </p>
        </div>
        <div className="text-right">
          <div className="font-headline text-3xl font-bold">{credits.display}</div>
          <div className="font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">
            {credits.welcomeGranted ? 'incl. welcome bonus' : 'balance'}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTopUpOpen(true)}
          className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary/80"
        >
          Top up
        </button>
        <button
          type="button"
          onClick={() => credits.refetch()}
          className="rounded-full border border-outline-variant/40 px-4 py-2 text-sm transition-colors hover:border-primary/40"
        >
          Refresh
        </button>
      </div>

      {history && history.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-outline-variant/20">
          <table className="w-full text-sm">
            <thead className="bg-surface-container-high text-left font-mono text-[10px] uppercase text-on-surface-variant">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Tx</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => {
                const amt = Number(row.amount_usdc);
                return (
                  <tr key={row.id} className="border-t border-outline-variant/20">
                    <td className="px-3 py-2 font-mono text-xs text-on-surface-variant">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">{KIND_LABEL[row.kind]}</td>
                    <td
                      className={`px-3 py-2 text-right font-mono ${
                        amt >= 0 ? 'text-emerald-500' : 'text-on-surface'
                      }`}
                    >
                      {amt >= 0 ? '+' : ''}
                      ${amt.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-xs text-on-surface-variant">
                      {row.tx_hash && !row.tx_hash.startsWith('credit-') ? (
                        <Link
                          href={`https://sepolia.arbiscan.io/tx/${row.tx_hash}`}
                          target="_blank"
                          rel="noopener"
                          className="text-primary hover:underline"
                        >
                          {row.tx_hash.slice(0, 8)}…
                        </Link>
                      ) : (
                        <span>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <TopUpModal
        open={topUpOpen}
        onClose={() => setTopUpOpen(false)}
        onSuccess={() => credits.refetch()}
      />
    </section>
  );
}
