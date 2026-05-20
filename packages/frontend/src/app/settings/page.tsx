'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { usePermit } from '@/hooks/usePermit';
import { PermitManager } from '@/components/PermitManager';
import {
  BRAIN_KEY_VAULT_ADDRESS,
  KNOWLEDGE_REGISTRY_ADDRESS,
  SUBSCRIPTION_CONTROLLER_ADDRESS,
  AGENT_BACKEND_URL,
} from '@/lib/contracts';

const TIERS = [
  { id: 'week', label: 'Weekly', price: '$5', duration: '7 days' },
  { id: 'month', label: 'Monthly', price: '$15', duration: '30 days', best: true },
  { id: 'quarter', label: 'Quarterly', price: '$35', duration: '90 days' },
];

const CONTRACTS = [
  { name: 'BrainKeyVault', address: BRAIN_KEY_VAULT_ADDRESS },
  { name: 'KnowledgeBaseRegistry', address: KNOWLEDGE_REGISTRY_ADDRESS },
  { name: 'SubscriptionController', address: SUBSCRIPTION_CONTROLLER_ADDRESS },
];

export default function SettingsPage() {
  const { authenticated, ready, user, login, logout } = usePrivy();
  const userAddress = user?.wallet?.address as `0x${string}` | undefined;
  const { permitState, reason, authorize, revoke, loading, error } = usePermit(userAddress);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [subResult, setSubResult] = useState<string | null>(null);
  const [subError, setSubError] = useState<string | null>(null);

  async function handleSubscribe(tier: string) {
    if (!userAddress) return;
    setSubscribing(tier);
    setSubError(null);
    try {
      const r = await fetch(`${AGENT_BACKEND_URL}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-wallet-address': userAddress },
        body: JSON.stringify({ tier }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error ?? 'Subscribe failed');
      }
      const data = await r.json();
      setSubResult(
        `Subscribed (${data.tier}) — expires ${new Date(data.expiresAt).toLocaleDateString()}`,
      );
    } catch (e: any) {
      setSubError(e?.message ?? 'Subscribe failed');
    } finally {
      setSubscribing(null);
    }
  }

  if (!ready) return null;
  if (!authenticated) {
    return (
      <div className="space-y-3 py-20 text-center">
        <h1 className="font-headline text-2xl font-bold">Connect to manage settings</h1>
        <button onClick={login} className="rounded-full bg-primary px-5 py-3 text-on-primary">
          Connect wallet
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-headline text-3xl font-bold">Settings</h1>
        <p className="text-on-surface-variant">Permits, subscription, and contract addresses.</p>
      </div>

      <section className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface p-6">
        <h2 className="font-headline text-lg font-semibold">Wallet</h2>
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

      <section className="space-y-3">
        <h2 className="font-headline text-lg font-semibold">FHE permit</h2>
        <PermitManager
          permitState={permitState}
          authorize={authorize}
          revoke={revoke}
          loading={loading}
          error={error}
          reason={reason}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-headline text-lg font-semibold">Subscription</h2>
        {subResult && (
          <div className="rounded-lg border border-secondary/30 bg-secondary/10 p-3 text-sm text-secondary">
            {subResult}
          </div>
        )}
        {subError && (
          <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
            {subError}
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-3">
          {TIERS.map((t) => (
            <div
              key={t.id}
              className={`relative rounded-xl border bg-surface p-5 ${
                t.best ? 'border-primary/40' : 'border-outline-variant/30'
              }`}
            >
              {t.best && (
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-primary px-2 py-0.5 font-mono text-[10px] text-on-primary">
                  BEST VALUE
                </span>
              )}
              <div className="font-headline text-base font-semibold">{t.label}</div>
              <div className="mt-2 font-headline text-3xl font-bold">{t.price}</div>
              <div className="mt-1 font-mono text-[11px] text-on-surface-variant">
                {t.duration} · USDC
              </div>
              <button
                onClick={() => handleSubscribe(t.id)}
                disabled={subscribing !== null}
                className="mt-4 w-full rounded-full bg-primary py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {subscribing === t.id ? 'Processing…' : 'Subscribe'}
              </button>
            </div>
          ))}
        </div>
      </section>

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
                  <td className="px-4 py-3 font-mono text-xs text-on-surface-variant">
                    {c.address || '—'}
                  </td>
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
