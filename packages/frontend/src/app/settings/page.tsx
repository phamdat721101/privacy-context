'use client';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { usePermit } from '@/hooks/usePermit';
import { usePrivacyDisclosure } from '@/hooks/useEncryptedBalance';
import { useTier } from '@/hooks/useTier';
import { useNetwork } from '@/hooks/useNetwork';
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
 *
 * Tier-aware composition: this page is the *only* place that decides which
 * encryption panel to render. `PermitManager` stays EVM/Fhenix-specific
 * (SRP); a Sui binding card is rendered inline for the trustless tier.
 * Adding a third tier later = one more branch here, nothing else.
 *
 * Subscriptions removed per docs/USP_BRIEF.md (sellers don't subscribe; buyers
 * pay per call via x402 on /v2/inference).
 */
export default function SettingsPage() {
  const { authenticated, ready, user, login, logout } = usePrivy();
  const userAddress = user?.wallet?.address as `0x${string}` | undefined;
  const { permitState, reason, authorize, revoke, loading, error } = usePermit(userAddress);
  const disclosure = usePrivacyDisclosure();
  const { tier } = useTier();
  const { network } = useNetwork();
  const suiAccount = useCurrentAccount();

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
        <p className="text-on-surface-variant">
          {tier === 'trustless'
            ? 'Trustless tier (Sui × Walrus × Tatum). Encryption + identity binding.'
            : 'Encryption and contract addresses.'}
        </p>
      </div>

      <section className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface p-6">
        <h2 className="font-headline text-lg font-semibold">Wallet</h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-xs text-on-surface-variant">EVM address</div>
            <div className="truncate font-mono text-sm">{userAddress}</div>
          </div>
          <button
            onClick={logout}
            className="rounded-full border border-outline-variant/40 px-4 py-2 text-sm text-error transition-colors hover:border-error/40"
          >
            Sign out
          </button>
        </div>
        {tier === 'trustless' && (
          <div className="border-t border-outline-variant/20 pt-3">
            <p className="font-mono text-[11px] uppercase tracking-widest text-outline">MemWal account</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link
                href="/account/memwal"
                className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/20"
              >
                Manage account →
              </Link>
              <Link
                href="/account/memwal/billing"
                className="rounded-lg border border-outline-variant/40 px-3 py-1.5 text-xs text-on-surface-variant hover:border-primary/40"
              >
                Billing →
              </Link>
            </div>
            <div className="mt-3 font-mono text-xs text-on-surface-variant">Sui address</div>
            <div className="truncate font-mono text-sm">
              {suiAccount?.address ?? <span className="text-on-surface-variant">— not connected. Click “Connect Sui” in the top bar.</span>}
            </div>
            {/* MCP onboarding — promoted out of the public nav into Settings.
                This is a seller-onboarding step, not a daily-use surface, so
                living here matches its actual frequency-of-use. */}
            <div className="mt-5 rounded-lg border border-secondary/30 bg-secondary/5 p-4">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-secondary">cable</span>
                <div className="flex-1">
                  <p className="font-headline text-sm font-semibold">Onboard your agent to MCP clients</p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    Generate a personalized <code className="rounded bg-surface px-1 font-mono">mcp.json</code>
                    for Cursor, Claude Desktop, Codex, Continue, or Windsurf.
                    Once added, the host can call your published agents as paid MCP tools.
                  </p>
                  <Link
                    href="/connect-mcp"
                    className="mt-3 inline-flex items-center gap-1 rounded-full bg-secondary px-4 py-1.5 text-xs font-medium text-on-secondary hover:opacity-90"
                  >
                    Open MCP setup →
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-headline text-lg font-semibold">Encryption</h2>
        {tier === 'trustless' ? (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <span
                  className="material-symbols-outlined text-primary"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  hub
                </span>
              </div>
              <div>
                <p className="font-semibold text-on-surface">Sui Trustless Tier Active</p>
                <p className="text-xs text-on-surface-variant">
                  AES-256-GCM in browser → SEAL IBE wrap → Walrus Quilt blob → Sui Move policy.
                  Tatum mirrors the on-chain ownership event.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant">
              <span className="material-symbols-outlined text-[14px]">link</span>
              <span className="font-mono">
                {suiAccount
                  ? `Bound to Sui ${suiAccount.address.slice(0, 8)}…${suiAccount.address.slice(-6)}`
                  : 'Sui wallet not connected — binding pending'}
              </span>
              {suiAccount && (
                <a
                  href={`${network.blockExplorer}&query=${suiAccount.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto text-primary hover:underline"
                >
                  View ↗
                </a>
              )}
            </div>
            <p className="text-xs text-on-surface-variant">
              No platform-side decryption keys. The trustless tier does not require an FHE permit;
              your Sui wallet authorizes Walrus reads via SEAL.
            </p>
            <Link
              href="/brain-sui/new"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              Publish a trustless brain →
            </Link>
          </div>
        ) : (
          <PermitManager
            permitState={permitState}
            authorize={authorize}
            revoke={revoke}
            loading={loading}
            error={error}
            reason={reason}
          />
        )}
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
        <h2 className="font-headline text-lg font-semibold">
          {tier === 'trustless' ? 'Standard-tier contracts (Arbitrum Sepolia)' : 'Contracts (Arbitrum Sepolia)'}
        </h2>
        {tier === 'trustless' && (
          <p className="text-xs text-on-surface-variant">
            Listed for reference — these contracts are inactive on the trustless tier.
          </p>
        )}
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
