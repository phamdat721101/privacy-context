'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AgentCard } from '@/components/AgentCard';
import { listAgents, type Agent } from '@/lib/agents';

const VALUE_PROPS = [
  {
    icon: 'enhanced_encryption',
    title: 'Knowledge stays encrypted',
    body: "Training data is AES-encrypted in your browser; the key is wrapped as an FHE euint128 on-chain. Even the platform can't read it without your permit.",
  },
  {
    icon: 'verified',
    title: 'Cryptographic ownership',
    body: 'Every agent has an encrypted Merkle root proving ownership. Revoking access is one transaction — not a database flag.',
  },
  {
    icon: 'smart_toy',
    title: 'Hire, don’t scrape',
    body: 'Producers train agents on private knowledge. Consumers chat with them and get verified answers. Raw chunks never leave the encrypted store.',
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
      {/* Hero */}
      <section className="relative overflow-hidden rounded-xl border border-outline-variant/30 bg-surface px-6 py-16 md:px-12 md:py-24">
        <div className="absolute -top-20 right-0 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-20 -left-10 h-72 w-72 rounded-full bg-secondary/10 blur-3xl" />
        <div className="relative z-10 max-w-2xl space-y-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-mono text-xs text-primary">
            <span className="material-symbols-outlined text-[14px]">lock</span>
            Encrypted via Fhenix CoFHE
          </span>
          <h1 className="font-headline text-4xl font-bold leading-tight md:text-6xl">
            Hire AI agents you can <span className="text-primary">actually trust</span>.
          </h1>
          <p className="text-lg text-on-surface-variant md:text-xl">
            Fhedin is the marketplace for AI agents trained on FHE-encrypted knowledge. Owners stay
            in control of their data. Consumers get verified answers.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/marketplace"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 font-medium text-on-primary transition-colors hover:bg-primary/90"
            >
              <span className="material-symbols-outlined text-[20px]">storefront</span>
              Browse agents
            </Link>
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 rounded-full border border-outline-variant/40 px-5 py-3 font-medium text-on-surface transition-colors hover:border-primary/40"
            >
              <span className="material-symbols-outlined text-[20px]">science</span>
              Train your own
            </Link>
          </div>
        </div>
      </section>

      {/* Value props */}
      <section>
        <h2 className="mb-8 font-headline text-2xl font-bold">Why Fhedin</h2>
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

      {/* Featured agents */}
      <section>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-headline text-2xl font-bold">Featured agents</h2>
          <Link href="/marketplace" className="text-sm text-primary hover:underline">
            View all →
          </Link>
        </div>
        {featured.length === 0 ? (
          <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-10 text-center">
            <p className="text-on-surface-variant">No agents published yet.</p>
            <Link
              href="/studio"
              className="mt-3 inline-block text-sm text-primary hover:underline"
            >
              Be the first to launch one →
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((a) => (
              <AgentCard key={a.id} {...a} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
