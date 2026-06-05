'use client';

/**
 * /marketplace/[brainId] — MemWal-tier brain detail page.
 *
 * Public route — anyone can browse before they connect a wallet. Paid query
 * is gated through `useMemWalAdapter` which fails closed off Sui (G1) and
 * the server's requireSuiWallet (G2).
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ProofBundle, type ProofBundleData } from '@/components/ProofBundle';
import { useNetwork } from '@/hooks/useNetwork';
import { useMemWalAdapter } from '@/hooks/useMemWalAdapter';
import { isSuiNetwork } from '@/lib/networks';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import { useActiveWallet } from '@/hooks/useActiveWallet';

interface BrainDetail {
  sui_object_id: string;
  seller_wallet: string;
  memwal_account_id: string;
  namespace: string;
  title: string;
  description: string;
  price_per_query_usdc: string;
  kya_required: boolean;
  attestation_required: number;
  cognitive_level: number;
  sovereignty_proof_url: string;
}

interface QueryResp {
  ok: true;
  results: Array<{ blob_id: string; text: string; distance: number }>;
  total: number;
  attestation: ProofBundleData;
  billing: { rail: string; tx_hash: string | null };
}

export default function BrainDetailPage() {
  const params = useParams<{ brainId: string }>();
  const brainId = params.brainId;
  const [brain, setBrain] = useState<BrainDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  // Payment rail selector. Defaults to Sui-native USDC since the brain is
  // a Sui Move object. The backend reads `x-payment-rail` header and
  // records the choice in `memwal_paid_queries.payment_rail` for the
  // settlement worker. Rails added here = one entry, no other code change.
  const [rail, setRail] = useState<'sui_usdc' | 'x402' | 'mock'>('sui_usdc');
  const [resp, setResp] = useState<QueryResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { network } = useNetwork();
  const { address } = useActiveWallet();
  const onSui = isSuiNetwork(network);
  // The hook is the single typed wrapper around /v3/memory/* — used here for
  // paid query via /v3/memory/brain/:id/query but the route currently lives
  // outside the hook surface (since it's brain-id-scoped). We call fetch
  // directly with the same headers shape as the hook.
  useMemWalAdapter(address);

  useEffect(() => {
    if (!brainId) return;
    setLoading(true);
    fetch(`${AGENT_BACKEND_URL}/v3/memory/brain/${brainId}`)
      .then((r) => (r.ok ? r.json() : { brain: null }))
      .then((j) => setBrain(j.brain))
      .finally(() => setLoading(false));
  }, [brainId]);

  async function runQuery() {
    if (!query.trim() || !address) return;
    setBusy(true);
    setErr(null);
    setResp(null);
    try {
      const r = await fetch(`${AGENT_BACKEND_URL}/v3/memory/brain/${brainId}/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-chain': 'sui',
          'x-wallet-address': address,
          'x-payment-rail': rail,
        },
        body: JSON.stringify({ query, limit: 5 }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message ?? `HTTP ${r.status}`);
      setResp(j as QueryResp);
    } catch (e) {
      setErr((e as Error)?.message ?? 'query failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="py-20 text-center text-on-surface-variant">Loading…</div>;
  }
  if (!brain) {
    return (
      <div className="py-20 text-center">
        <p className="text-on-surface-variant">Brain not found.</p>
        <Link href="/marketplace" className="mt-2 inline-block text-primary hover:underline">
          ← back to marketplace
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/marketplace" className="text-xs text-on-surface-variant hover:text-primary">
        ← Marketplace
      </Link>

      <div className="rounded-lg border border-outline-variant/40 bg-surface-container-low/60 p-6 backdrop-blur">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="font-headline text-2xl font-bold">{brain.title}</h1>
            <p className="mt-1 font-mono text-xs text-on-surface-variant">
              namespace: {brain.namespace}
            </p>
            <p className="mt-3 max-w-2xl text-sm text-on-surface-variant">{brain.description}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="font-mono text-2xl text-primary">
              ${Number(brain.price_per_query_usdc).toFixed(2)}
            </div>
            <span className="font-mono text-[10px] uppercase tracking-widest text-outline">per query</span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-outline-variant/40 bg-surface-container-low/60 p-6 backdrop-blur">
        <h2 className="mb-3 font-headline text-lg">Run a query</h2>
        {!onSui && (
          <p className="mb-3 rounded border border-amber-300/30 bg-amber-300/5 p-2 text-xs text-amber-300">
            Switch to Sui to run paid queries. Browsing this page works on any network.
          </p>
        )}
        {brain.attestation_required === 2 && (
          <FhePermitPanel brainId={brainId} namespace={brain.namespace} address={address} />
        )}
        {/* Payment rail picker — buyer chooses which network/voucher pays
            for this call. Defaults to Sui USDC (the brain's native chain).
            x402 routes through Base/Arbitrum vouchers; `mock` is the
            free dev path (only honored when the API runs with
            MEMWAL_FALLBACK_MODE=mock). Adding a rail = one entry below. */}
        <div className="mb-3 flex items-center gap-2">
          <label className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
            pay with
          </label>
          <select
            value={rail}
            onChange={(e) => setRail(e.target.value as typeof rail)}
            disabled={busy}
            className="rounded-lg border border-outline-variant/40 bg-surface px-3 py-1.5 font-mono text-xs focus:border-primary focus:outline-none"
          >
            <option value="sui_usdc">Sui USDC (testnet)</option>
            <option value="x402">x402 voucher (Base / Arbitrum)</option>
            <option value="mock">Mock (free, dev)</option>
          </select>
        </div>
        <div className="flex flex-col gap-3 md:flex-row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask the brain anything…"
            disabled={busy}
            className="flex-1 rounded-lg border border-outline-variant/40 bg-surface px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none"
          />
          <button
            onClick={runQuery}
            disabled={busy || !query.trim() || !onSui || !address}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-40"
          >
            {busy
              ? '…'
              : address && address.toLowerCase() === brain.seller_wallet.toLowerCase()
                ? 'Query (free · owner)'
                : `Pay $${Number(brain.price_per_query_usdc).toFixed(2)} & query`}
          </button>
        </div>
        {err && <p className="mt-3 text-xs text-error">{err}</p>}
      </div>

      {resp && (
        <div className="space-y-4">
          <div className="rounded-lg border border-outline-variant/40 bg-surface-container-low/60 p-6 backdrop-blur">
            <h2 className="mb-3 font-headline text-lg">Results ({resp.total})</h2>
            <ol className="list-decimal space-y-2 pl-6 text-sm">
              {resp.results.map((r, i) => (
                <li key={i} className="text-on-surface">
                  <p>{r.text}</p>
                  <p className="mt-1 font-mono text-[10px] text-outline">
                    blob: {r.blob_id} · distance: {r.distance.toFixed(3)}
                  </p>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h2 className="mb-3 font-headline text-lg">Three-proof attestation</h2>
            <ProofBundle data={resp.attestation} />
            <p className="mt-3 text-xs text-outline">
              Independently verifiable on-chain via the explorer links above.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * FhePermitPanel — surfaced on FHE-encrypted brains (attestation_required === 2).
 *
 * Buyers must hold a fresh per-namespace permit to decrypt FHE-wrapped recall
 * results. The seller's signing wallet issues the permit via /v3/memory/fhe/permit/issue;
 * we surface a one-click "Request permit" button + display the resulting permit
 * format (`<expiry>.<hex>`) with copy. Real client-side unwrap lands in Phase 5
 * once the CoFHE coprocessor is wired into the browser; today the permit
 * proves the wire path is end-to-end.
 */
function FhePermitPanel({
  brainId,
  namespace,
  address,
}: {
  brainId: string;
  namespace: string;
  address: string | undefined;
}) {
  const [permit, setPermit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function requestPermit() {
    if (!address) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${AGENT_BACKEND_URL}/v3/memory/fhe/permit/issue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-chain': 'sui',
          'x-wallet-address': address,
        },
        body: JSON.stringify({ namespace, buyerWallet: address, expirySeconds: 600 }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message ?? `HTTP ${r.status}`);
      setPermit(j.permit ?? null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 rounded-lg border border-tertiary/40 bg-tertiary/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-tertiary text-[20px]">lock</span>
          <p className="font-headline text-sm text-on-surface">FHE-encrypted brain</p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-tertiary">
          permit required
        </span>
      </div>
      <p className="mt-2 text-xs text-on-surface-variant">
        Recall results are returned as FHE ciphertexts that decrypt only under a
        per-namespace permit signed for {address ? address.slice(0, 6) + '…' + address.slice(-4) : 'your wallet'}.
        Permits expire after 10 minutes.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={requestPermit}
          disabled={busy || !address}
          className="rounded border border-tertiary/40 bg-tertiary/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-tertiary hover:bg-tertiary/20 disabled:opacity-40"
        >
          {busy ? 'Requesting…' : permit ? 'Re-issue permit' : 'Request permit'}
        </button>
        {permit && (
          <code
            className="flex-1 truncate rounded border border-outline-variant/40 bg-black px-2 py-1 font-mono text-[11px] text-on-surface"
            title={permit}
            onClick={() => navigator.clipboard?.writeText(permit).catch(() => undefined)}
          >
            {permit}
          </code>
        )}
      </div>
      {err && <p className="mt-2 font-mono text-xs text-error">{err}</p>}
    </div>
  );
}
