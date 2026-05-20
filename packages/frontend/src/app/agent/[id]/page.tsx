'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getAgent, type Agent } from '@/lib/agents';

export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getAgent(id)
      .then(setAgent)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="py-20 text-center text-on-surface-variant">Loading agent…</div>;
  }

  if (!agent) {
    return (
      <div className="py-20 text-center">
        <p className="text-on-surface-variant">Agent not found.</p>
        <Link href="/marketplace" className="mt-3 inline-block text-sm text-primary hover:underline">
          ← Back to marketplace
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-3">
      {/* Main column */}
      <div className="space-y-6 md:col-span-2">
        <div className="rounded-xl border border-outline-variant/30 bg-surface p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <span className="material-symbols-outlined text-[28px]">smart_toy</span>
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-headline text-2xl font-bold">{agent.title}</h1>
                <span className="inline-flex items-center gap-1 rounded-full border border-secondary/30 bg-secondary/10 px-2 py-0.5 font-mono text-[10px] text-secondary">
                  <span className="material-symbols-outlined text-[12px]">verified_user</span>
                  FHE Verified
                </span>
              </div>
              <p className="font-mono text-xs text-on-surface-variant">
                Owner {agent.ownerAddress.slice(0, 8)}…{agent.ownerAddress.slice(-4)}
              </p>
            </div>
          </div>
          <p className="mt-6 text-on-surface-variant">{agent.description}</p>
          {agent.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {agent.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-outline-variant/40 px-2 py-0.5 font-mono text-xs text-on-surface-variant"
                >
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4 rounded-xl border border-outline-variant/30 bg-surface p-6">
          <h2 className="font-headline text-lg font-semibold">Capabilities</h2>
          <ul className="space-y-2 text-sm text-on-surface-variant">
            <li className="flex items-start gap-2">
              <span className="material-symbols-outlined mt-0.5 text-[16px] text-secondary">
                check
              </span>
              Answers grounded in encrypted knowledge — no hallucinations from public data.
            </li>
            <li className="flex items-start gap-2">
              <span className="material-symbols-outlined mt-0.5 text-[16px] text-secondary">
                check
              </span>
              Every response carries an FHE attestation badge.
            </li>
            <li className="flex items-start gap-2">
              <span className="material-symbols-outlined mt-0.5 text-[16px] text-secondary">
                check
              </span>
              Owner can revoke access cryptographically — your subscription is refunded if cut early.
            </li>
          </ul>
        </div>

        <div className="space-y-2 rounded-xl border border-outline-variant/30 bg-surface-container-low p-6">
          <div className="flex items-center gap-2 text-on-surface-variant">
            <span className="material-symbols-outlined text-[18px] text-primary">lock</span>
            <span className="font-mono text-xs uppercase tracking-wider">
              Encrypted via Fhenix CoFHE
            </span>
          </div>
          <p className="text-sm text-on-surface-variant">
            This agent&apos;s knowledge base is AES-encrypted at rest; the AES key is stored as an{' '}
            <code className="font-mono text-primary">euint128</code> on Arbitrum Sepolia. Only your
            wallet-signed FHE permit can unlock it for inference.
          </p>
        </div>
      </div>

      {/* Hire CTA */}
      <aside className="space-y-4">
        <div className="sticky top-24 space-y-4 rounded-xl border border-primary/30 bg-surface p-6">
          <div className="space-y-1">
            <div className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
              Pricing
            </div>
            <div className="font-headline text-3xl font-bold">
              $15
              <span className="ml-1 font-mono text-sm font-normal text-on-surface-variant">
                / month USDC
              </span>
            </div>
            <div className="text-xs text-on-surface-variant">
              Unlimited messages while your subscription is active.
            </div>
          </div>
          <Link
            href={`/chat/${agent.id}`}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 font-medium text-on-primary transition-colors hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-[18px]">chat</span>
            Hire &amp; chat
          </Link>
          <div className="space-y-2 border-t border-outline-variant/20 pt-4 text-xs text-on-surface-variant">
            <div className="flex items-center justify-between">
              <span>Latency</span>
              <span className="font-mono text-on-surface">~2s</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Tier</span>
              <span className="font-mono text-on-surface">Standard</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Network</span>
              <span className="font-mono text-on-surface">Arbitrum Sepolia</span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
