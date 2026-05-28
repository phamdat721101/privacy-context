'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AgentCard } from '@/components/AgentCard';
import { listAgents, type Agent } from '@/lib/agents';

/**
 * Landing — the new USP-first home page.
 *
 * Per docs/USP_BRIEF.md: lead with the magic verb "earn", not "store" or "hire".
 * Primary CTA goes to /memory (the live Sovereign + Platform lanes). Secondary
 * goes to /marketplace (buyer / demo side). The existing AgentCard is reused
 * for the featured brains row — no new component file.
 */
const VALUE_PROPS = [
  {
    icon: 'paid',
    title: 'You earn, you don\'t pay',
    body:
      'Publish a sentence, a note or a corpus once. AI agents pay you in USDC every time they query it. The platform takes a small fee — sellers do not subscribe.',
  },
  {
    icon: 'enhanced_encryption',
    title: 'The platform can\'t read it',
    body:
      'Knowledge is AES-256-GCM encrypted in your browser; the key is FHE-wrapped on Arbitrum (BrainKeyVaultV2). We literally cannot decrypt your raw text.',
  },
  {
    icon: 'verified',
    title: 'Every answer carries a receipt',
    body:
      'Buyers get TEE-attested answers (Phala). Sellers get an x402 receipt per query, with the agent\'s ERC-8004 identity. No promises — only artifacts.',
  },
];

export default function LandingPage() {
  const [featured, setFeatured] = useState<Agent[]>([]);

  useEffect(() => {
    listAgents()
      .then((all) => setFeatured(all.slice(0, 6)))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-20">
      {/* Hero — USP-first */}
      <section className="relative overflow-hidden rounded-xl border border-outline-variant/30 bg-surface px-6 py-16 md:px-12 md:py-24">
        <div className="absolute -top-20 right-0 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-20 -left-10 h-72 w-72 rounded-full bg-secondary/10 blur-3xl" />
        <div className="relative z-10 max-w-3xl space-y-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-secondary/30 bg-secondary/10 px-3 py-1 font-mono text-xs text-secondary">
            <span className="material-symbols-outlined text-[14px]">paid</span>
            Patreon for AI agents · live on Arbitrum
          </span>
          <h1 className="font-headline text-4xl font-bold leading-tight md:text-6xl">
            Get paid when AI agents query <span className="text-primary">your brain</span>.
          </h1>
          <p className="text-lg text-on-surface-variant md:text-xl">
            OpenX is the marketplace where AI agents pay you in USDC to read knowledge only you control.
            We can&apos;t see what you publish. We can&apos;t see who asks.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/memory"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 font-medium text-on-primary transition-colors hover:opacity-90"
            >
              <span className="material-symbols-outlined text-[20px]">edit_note</span>
              Save your first memory
            </Link>
            <Link
              href="/marketplace"
              className="inline-flex items-center gap-2 rounded-full border border-outline-variant/40 px-5 py-3 font-medium text-on-surface transition-colors hover:border-primary/40"
            >
              <span className="material-symbols-outlined text-[20px]">storefront</span>
              Browse the marketplace
            </Link>
          </div>
        </div>
      </section>

      {/* Value props — seller-first framing */}
      <section>
        <h2 className="mb-8 font-headline text-2xl font-bold">Why publish on OpenX</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {VALUE_PROPS.map((v) => (
            <div
              key={v.title}
              className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface p-6"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <span className="material-symbols-outlined">{v.icon}</span>
              </div>
              <h3 className="font-headline text-lg font-semibold">{v.title}</h3>
              <p className="text-sm text-on-surface-variant">{v.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Featured brains — buyer side */}
      <section>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-headline text-2xl font-bold">Brains you can ask right now</h2>
          <Link href="/marketplace" className="text-sm text-primary hover:underline">
            View all →
          </Link>
        </div>
        {featured.length === 0 ? (
          <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-10 text-center">
            <p className="text-on-surface-variant">No brains published yet.</p>
            <Link
              href="/memory"
              className="mt-3 inline-block text-sm text-primary hover:underline"
            >
              Be the first to save one →
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((a) => (
              <AgentCard
                key={a.id}
                {...a}
                price={{ amount: '0.01', currency: 'USDC' }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
