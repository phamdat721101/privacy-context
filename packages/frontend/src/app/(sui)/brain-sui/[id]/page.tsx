'use client';

/**
 * /brain-sui/[id] — Trustless-tier brain detail page.
 *
 * Renders the trust-artifact panel (Walrus blob + Sui object + Tatum badges)
 * pulled from /v3/brains/:id/sovereignty-proof. The id IS the Sui publish
 * tx digest — it is the canonical on-chain anchor and serves as the page
 * header until title/description persistence lands in brains_trustless.
 *
 * SOLID:
 *  - SRP: layout-only. Data fetching colocates in TrustlessStatusPanel.
 *  - DIP: visualization is a separate component.
 *  - "Do not call the wrong tier's endpoint": this page deliberately does
 *    NOT hit /brains/:id (Standard-tier integer-id surface) — that schema
 *    is incompatible with trustless tx-digest ids and the call would crash
 *    the api on every page load.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useNetwork } from '@/hooks/useNetwork';
import { isSuiNetwork } from '@/lib/networks';
import { TrustlessStatusPanel } from '@/components/TrustlessVisualization';

export default function BrainSuiDetailPage() {
  const params = useParams<{ id: string }>();
  const { network } = useNetwork();

  if (!isSuiNetwork(network)) {
    return (
      <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-12 text-center">
        <h1 className="font-headline text-2xl font-bold">Trustless view requires Sui Testnet.</h1>
        <p className="mt-2 text-sm text-on-surface-variant">
          Switch to Sui Testnet to see Walrus blob + Sui object + Tatum status.
        </p>
        <Link
          href={`/agent/${params?.id ?? ''}`}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-medium text-on-primary hover:opacity-90"
        >
          Open standard view
        </Link>
      </div>
    );
  }

  // Render an abbreviated digest in the heading so it stays one line and
  // remains copy-able — the full digest is in the URL and the Sui badge
  // already links to the canonical Suiscan tx page.
  const digest = params?.id ?? '';
  const shortDigest = digest.length > 16 ? `${digest.slice(0, 8)}…${digest.slice(-6)}` : digest;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <p className="text-[11px] font-mono uppercase tracking-widest text-on-surface-variant">
          Trustless · Sui Testnet
        </p>
        <h1 className="mt-1 font-headline text-3xl font-bold" title={digest}>
          Brain <span className="font-mono text-2xl">#{shortDigest}</span>
        </h1>
        <p className="mt-2 text-sm text-on-surface-variant">Published brain</p>
      </header>

      <section className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-on-surface-variant">
          Trust artifacts
        </h2>
        <TrustlessStatusPanel brainId={digest} />
        <p className="mt-3 text-[11px] text-on-surface-variant">
          Click a badge to copy. Walrus and Sui badges link to public explorers — anyone can verify
          the brain's existence without going through OpenX.
        </p>
      </section>
    </div>
  );
}
