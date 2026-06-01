'use client';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { usePermit } from '@/hooks/usePermit';
import { usePrivacyDisclosure } from '@/hooks/useEncryptedBalance';
import { PermitManager } from '@/components/PermitManager';
import {
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
 * Settings — wallet, encryption, contracts.
 * Subscriptions removed per docs/USP_BRIEF.md (sellers don't subscribe; buyers
 * pay per call via x402 on /v2/inference).
 */
export default function SettingsPage() {
  const { authenticated, ready, user, login, logout } = usePrivy();
  const userAddress = user?.wallet?.address as `0x${string}` | undefined;
  const { permitState, reason, authorize, revoke, loading, error } = usePermit(userAddress);
  const disclosure = usePrivacyDisclosure();

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
        <p className="text-on-surface-variant">Encryption and contract addresses.</p>
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
        <h2 className="font-headline text-lg font-semibold">Encryption</h2>
        <PermitManager
          permitState={permitState}
          authorize={authorize}
          revoke={revoke}
          loading={loading}
          error={error}
          reason={reason}
        />
      </section>

      {/* T6/PRD-C: progressive-disclosure toggle. Off (default) → chat is
          byte-identical to today. On → settlement IDs + FHE handles render
          next to each assistant message. */}
      <section className="space-y-3">
        <h2 className="font-headline text-lg font-semibold">Privacy disclosure</h2>
        <label className="flex items-center justify-between gap-4 rounded-xl border border-outline-variant/30 bg-surface p-4">
          <div className="min-w-0">
            <div className="font-medium">Show encrypted receipts (advanced)</div>
            <div className="text-xs text-on-surface-variant">
              Reveals settlement IDs and FHE handles next to each chat message. Off by default.
            </div>
          </div>
          <input
            type="checkbox"
            checked={disclosure.enabled}
            onChange={(e) => disclosure.toggle(e.target.checked)}
            className="h-5 w-5 cursor-pointer accent-primary"
          />
        </label>
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
