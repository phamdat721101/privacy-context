'use client';

/**
 * /train — cognitive memory training console.
 *
 * Sui-only. Mirrors the mem-ui `openx_memwal_training_console` prototype.
 * One panel for source + level + write, one panel for the resulting
 * MemWal blob id + a deep-link to publish the brain on the marketplace.
 *
 * SOLID
 * -----
 *  - All namespace strings flow through `cogNamespace()` from the SDK
 *    (single source of truth — no template literals here).
 *  - Writes go through the existing `useMemWalAdapter` hook so the
 *    server-side path is identical to /v3/memory/remember.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { useActiveWallet } from '@/hooks/useActiveWallet';
import { useMemWalAdapter } from '@/hooks/useMemWalAdapter';
import { AGENT_BACKEND_URL, OPENX_BRAIN_PACKAGE_ID } from '@/lib/contracts';
import {
  cogNamespace,
  COGNITIVE_LEVEL_LABELS,
  COGNITIVE_DEFAULT_PRICES_USDC,
  type CognitiveLevel,
} from '@fhe-ai-context/sdk';

const LEVEL_COLORS: Record<CognitiveLevel, string> = {
  1: 'border-sky-300/40 bg-sky-300/5 text-sky-300',
  2: 'border-emerald-300/40 bg-emerald-300/5 text-emerald-300',
  3: 'border-violet-300/40 bg-violet-300/5 text-violet-300',
  4: 'border-amber-300/40 bg-amber-300/5 text-amber-300',
  5: 'border-rose-300/40 bg-rose-300/5 text-rose-300',
};

export interface TrainAndPublishPanelProps {
  /** When provided, overrides ?brainId=… and (with lockBrainId) hides the
   *  brain-id input. Use case: embedded inside the Studio brain detail
   *  page where the brain id is already known and shouldn't be typed. */
  brainId?: string;
  /** When true, the brain-id input is read-only (still rendered for
   *  context). Pairs with `brainId`. */
  lockBrainId?: boolean;
}

export function TrainAndPublishPanel({ brainId: brainIdProp, lockBrainId }: TrainAndPublishPanelProps = {}) {
  const { address } = useActiveWallet();
  const suiAccount = useCurrentAccount();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const router = useRouter();
  // Prop wins over URL — Studio passes the brain id directly. URL fallback
  // keeps the standalone /train console working for advanced users.
  const searchParams = useSearchParams();
  const initialBrainId = brainIdProp ?? searchParams?.get('brainId') ?? '';
  const adapter = useMemWalAdapter(address);
  const [level, setLevel] = useState<CognitiveLevel>(3);
  const [brainId, setBrainId] = useState(initialBrainId);
  const [sessionId, setSessionId] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ blob_id: string | null; job_id: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Publish-to-marketplace state. We deliberately keep this colocated with
  // training state — the seller's mental model is "I just trained, now
  // publish" — and the form is a thin Move-tx + API call wrapper.
  const [memwalAccountId, setMemwalAccountId] = useState('');
  const [pubTitle, setPubTitle] = useState('');
  const [pubDesc, setPubDesc] = useState('');
  const [pubPrice, setPubPrice] = useState('');
  const [pubBusy, setPubBusy] = useState(false);
  const [pubErr, setPubErr] = useState<string | null>(null);
  const [publishedId, setPublishedId] = useState<string | null>(null);

  const namespace = useMemo(() => {
    if (!brainId) return '';
    try {
      return cogNamespace(level, brainId, level === 1 ? sessionId || 'default' : undefined);
    } catch {
      return '';
    }
  }, [level, brainId, sessionId]);

  // Auto-fetch the seller's MemWalAccount id once the wallet connects on
  // Sui — saves the friction of pasting a long hex id from MemWal app.
  // Falls back to manual paste if the wallet hasn't been provisioned yet.
  useEffect(() => {
    if (!address || memwalAccountId) return;
    let cancelled = false;
    fetch(`${AGENT_BACKEND_URL}/v3/memory/account`, {
      headers: { 'x-wallet-address': address, 'x-chain': 'sui' },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.accountId) return;
        setMemwalAccountId(j.accountId);
      })
      .catch(() => {
        /* non-fatal — manual paste still works */
      });
    return () => {
      cancelled = true;
    };
  }, [address, memwalAccountId]);

  async function submit() {
    if (!text.trim() || !namespace) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const out = await adapter.remember({ text, namespace });
      setResult({ blob_id: out.blob_id ?? null, job_id: out.job_id ?? null });
      // Pre-fill the publish title from the brain id so sellers don't
      // re-type. Keeps the "train → publish" flow on one page.
      if (!pubTitle) setPubTitle(brainId);
      if (!pubPrice) setPubPrice(String(COGNITIVE_DEFAULT_PRICES_USDC[level]));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Publish flow — single click does Move-tx + API cache.
   *
   * 1. PTB calls `openx_memwal_marketplace::publish_brain`. Seller signs;
   *    the Move module sets `seller = ctx.sender()` so the operator can
   *    NOT impersonate (intentional — payments would route wrong).
   * 2. Extract the `MemWalBrain` shared object id from tx effects.
   * 3. Cache metadata in `/v3/memory/marketplace/publish` so the catalog
   *    surfaces the brain without an extra Sui RPC fetch on every browse.
   * 4. Redirect to the brain detail page where the seller can share the
   *    URL with buyers.
   *
   * SOLID: this is the only place that constructs the publish PTB.
   * `OPENX_BRAIN_PACKAGE_ID` (from `lib/contracts.ts`) is the one swap-point
   * if the Move package is upgraded — no shotgun edits.
   */
  async function publish() {
    if (!result || !namespace || !suiAccount || !address) return;
    if (!memwalAccountId.trim() || !pubTitle.trim() || !pubPrice.trim()) {
      setPubErr('account id, title and price are required');
      return;
    }
    const priceMicro = BigInt(Math.round(Number(pubPrice) * 1_000_000));
    if (priceMicro < 0n) {
      setPubErr('price must be >= 0');
      return;
    }
    setPubBusy(true);
    setPubErr(null);
    try {
      const enc = new TextEncoder();
      const tx = new Transaction();
      tx.moveCall({
        target: `${OPENX_BRAIN_PACKAGE_ID}::openx_memwal_marketplace::publish_brain`,
        arguments: [
          tx.pure.id(memwalAccountId),
          tx.pure.vector('u8', Array.from(enc.encode(namespace))),
          tx.pure.vector('u8', Array.from(enc.encode(pubTitle))),
          tx.pure.vector('u8', Array.from(enc.encode(pubDesc))),
          tx.pure.u64(priceMicro),
          tx.pure.bool(false), // kya_required
          tx.pure.u8(0),       // attestation_required
          tx.pure.vector('u8', []), // sovereignty_proof_url (optional)
          tx.pure.u8(level),
          tx.object('0x6'),    // sui::clock::Clock
        ],
      });
      const out = await signAndExecute({
        // Cast to dapp-kit's expected type. wallet-standard bundles its own
        // copy of @mysten/sui causing a type duplicate; same workaround as
        // /(sui)/brain-sui/new/page.tsx. We intentionally DO NOT pass
        // `options` here — `useSignAndExecuteTransaction` requires options
        // to be configured at hook initialization time and most wallets
        // drop the hint anyway. We resolve the brain id below by querying
        // the chain directly using the digest, which is always reliable.
        transaction: tx,
        chain: 'sui:testnet',
      } as unknown as Parameters<typeof signAndExecute>[0]);
      // Extract the newly-created MemWalBrain object id. Two shapes are
      // possible across wallet versions, in priority order:
      //   1. `objectChanges` — modern dapp-kit / Sui Wallet Standard.
      //      Each entry has `type: 'created' | 'mutated' | …` and an
      //      `objectId` + `objectType` we can match on `MemWalBrain`.
      //   2. `effects.created[0].reference.objectId` — legacy shape.
      // We try (1) first because it's the documented stable contract.
      // Brain id resolution. Structural forcing: dapp-kit's
      // `useSignAndExecuteTransaction` returns a minimal `{ digest }` shape
      // by design — `options` must be configured at the HOOK level, not the
      // call site, and even then most wallets (Slush, Sui Wallet) drop the
      // hint. So we don't bet on the wallet response. Instead we use the
      // only artifact every wallet reliably returns (the digest) and fetch
      // the tx from the Sui RPC, which is always authoritative.
      //
      // Indexer lag handling: `sui_getTransactionBlock` may answer "not
      // found" for ~500ms after submission while the indexer catches up.
      // One retry with backoff covers the long tail without making the
      // happy path slower.
      type ObjectChange = {
        type?: string;
        objectId?: string;
        objectType?: string;
      };
      const digest = (out as { digest?: string }).digest;
      if (!digest) throw new Error('Wallet did not return a transaction digest');

      const rpc =
        process.env.NEXT_PUBLIC_SUI_RPC_URL ?? 'https://fullnode.testnet.sui.io';
      const fetchBrainId = async (): Promise<string | undefined> => {
        const r = await fetch(rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'sui_getTransactionBlock',
            params: [digest, { showObjectChanges: true }],
          }),
        });
        const j = (await r.json()) as {
          result?: { objectChanges?: ObjectChange[] };
        };
        return (j.result?.objectChanges ?? [])
          .filter((c) => c.type === 'created')
          .find((c) => (c.objectType ?? '').includes('MemWalBrain'))?.objectId;
      };

      let brainObjectId = await fetchBrainId();
      if (!brainObjectId) {
        await new Promise((r) => setTimeout(r, 1200));
        brainObjectId = await fetchBrainId();
      }
      if (!brainObjectId) {
        throw new Error(
          `Brain mint succeeded (digest=${digest}) but the indexer hasn't ` +
            `caught up. Refresh /marketplace in a moment — the listing will appear.`,
        );
      }

      const r = await fetch(`${AGENT_BACKEND_URL}/v3/memory/marketplace/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': address,
          'x-chain': 'sui',
        },
        body: JSON.stringify({
          suiObjectId: brainObjectId,
          memwalAccountId,
          namespace,
          title: pubTitle,
          description: pubDesc,
          pricePerQueryUsdc: pubPrice,
          cognitiveLevel: level,
          attestationRequired: 0,
          kyaRequired: false,
          sovereigntyProofUrl: '',
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error ?? `API publish failed (${r.status})`);
      }
      setPublishedId(brainObjectId);
      // Give the seller ~3 seconds to read the success card before redirecting.
      // Anything below ~2s feels like the page jumped without confirmation.
      setTimeout(() => router.push(`/marketplace/${brainObjectId}`), 3000);
    } catch (e) {
      setPubErr((e as Error).message);
    } finally {
      setPubBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="border-b border-outline-variant/30 pb-4">
        <h1 className="font-headline text-2xl font-bold">Train Console</h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          Write text into your Walrus Memory account, tagged by cognitive level.
          The resulting blob is yours; OpenX is not in the trust path.
        </p>
      </header>

      {/* Level picker */}
      <section>
        <label className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-outline">
          cognitive level
        </label>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {([1, 2, 3, 4, 5] as CognitiveLevel[]).map((n) => (
            <button
              key={n}
              onClick={() => setLevel(n)}
              className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition ${
                level === n ? LEVEL_COLORS[n] : 'border-outline-variant/40 bg-surface-container-low/60 hover:border-outline'
              }`}
            >
              <span className="font-mono text-[10px] uppercase tracking-wider">L{n}</span>
              <span className="font-headline text-sm">{COGNITIVE_LEVEL_LABELS[n]}</span>
              <span className="font-mono text-[10px] text-on-surface-variant">
                ${COGNITIVE_DEFAULT_PRICES_USDC[n]}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Brain + session inputs */}
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-outline">
            brain id
          </label>
          <input
            value={brainId}
            onChange={(e) => setBrainId(e.target.value.trim())}
            readOnly={lockBrainId}
            placeholder="e.g. medical-research"
            className={`w-full rounded-lg border border-outline-variant/40 bg-surface px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none ${
              lockBrainId ? 'cursor-not-allowed opacity-60' : ''
            }`}
          />
        </div>
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-outline">
            session id {level === 1 ? '(required for L1)' : '(L1-only)'}
          </label>
          <input
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value.trim())}
            disabled={level !== 1}
            placeholder={level === 1 ? 'e.g. 0xdeadbeef' : 'n/a'}
            className="w-full rounded-lg border border-outline-variant/40 bg-surface px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none disabled:opacity-50"
          />
        </div>
      </section>

      {/* Resolved namespace badge */}
      <p className="font-mono text-xs text-on-surface-variant">
        will write to:{' '}
        <span className={`ml-2 inline-block rounded border px-2 py-1 ${LEVEL_COLORS[level]}`}>
          {namespace || '(complete the form)'}
        </span>
      </p>

      {/* Text */}
      <section>
        <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-outline">
          memory body
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          disabled={busy}
          placeholder="Paste any text you want to remember…"
          className="w-full rounded-lg border border-outline-variant/40 bg-surface px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none"
        />
      </section>

      <div className="flex gap-3">
        <button
          onClick={submit}
          disabled={busy || !text.trim() || !namespace || !adapter.onSui || !address}
          className="rounded-lg bg-primary px-4 py-2 font-medium text-on-primary disabled:opacity-40"
        >
          {busy ? 'Writing…' : 'Train'}
        </button>
      </div>

      {err && (
        <p className="rounded-lg border border-error/40 bg-error/5 p-3 font-mono text-xs text-error">
          {err}
        </p>
      )}

      {result && (
        <div className="rounded-lg border border-secondary/40 bg-secondary/5 p-4 backdrop-blur">
          <p className="font-mono text-[10px] uppercase tracking-widest text-secondary">stored</p>
          <p className="mt-2 font-mono text-sm text-on-surface">
            {result.blob_id ? `blob: ${result.blob_id}` : `job: ${result.job_id}`}
          </p>
          <p className="mt-1 font-mono text-[11px] text-on-surface-variant">namespace: {namespace}</p>
        </div>
      )}

      {/* Publish-to-marketplace section. Shows after a successful train so
          sellers see the on-ramp without leaving the page. The Move tx + API
          cache happen in `publish()` above as a single atomic UX. */}
      {result && (
        <section className="rounded-xl border border-primary/30 bg-surface-container-low/60 p-5">
          <header className="mb-3 flex items-baseline justify-between">
            <h2 className="font-headline text-lg font-semibold">Publish brain to marketplace</h2>
            <span className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
              {COGNITIVE_LEVEL_LABELS[level]} · L{level}
            </span>
          </header>
          <p className="mb-4 text-sm text-on-surface-variant">
            Mints a <code className="rounded bg-surface px-1 font-mono text-xs">MemWalBrain</code> Move
            object on Sui (you sign; OpenX never custodies the seller key) and lists it as a paid MCP
            tool. Buyers query it through any connected agent and you earn USDC per call.
          </p>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-outline">
                memwal account id
              </label>
              <input
                value={memwalAccountId}
                onChange={(e) => setMemwalAccountId(e.target.value.trim())}
                placeholder="0x… (your MemWalAccount object id)"
                className="w-full rounded-lg border border-outline-variant/40 bg-surface px-3 py-2 font-mono text-xs focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-outline">
                price per query (USDC)
              </label>
              <input
                value={pubPrice}
                onChange={(e) => setPubPrice(e.target.value.trim())}
                placeholder={String(COGNITIVE_DEFAULT_PRICES_USDC[level])}
                className="w-full rounded-lg border border-outline-variant/40 bg-surface px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-outline">
                title
              </label>
              <input
                value={pubTitle}
                onChange={(e) => setPubTitle(e.target.value)}
                placeholder="e.g. Medical Research L3"
                className="w-full rounded-lg border border-outline-variant/40 bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-outline">
                description
              </label>
              <textarea
                value={pubDesc}
                onChange={(e) => setPubDesc(e.target.value)}
                rows={3}
                placeholder="What questions does this brain answer well?"
                className="w-full rounded-lg border border-outline-variant/40 bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={publish}
              disabled={pubBusy || !suiAccount || !memwalAccountId || !pubTitle || !pubPrice}
              className="rounded-lg bg-primary px-4 py-2 font-medium text-on-primary disabled:opacity-40"
            >
              {pubBusy ? 'Publishing…' : 'Publish (sign Sui tx)'}
            </button>
            <Link
              href="/marketplace?type=memwal"
              className="text-sm text-on-surface-variant hover:text-on-surface"
            >
              Browse catalog →
            </Link>
          </div>

          {pubErr && (
            <p className="mt-3 rounded-lg border border-error/40 bg-error/5 p-3 font-mono text-xs text-error">
              {pubErr}
            </p>
          )}
          {publishedId && (
            <div className="mt-3 rounded-lg border border-emerald-400/40 bg-emerald-400/5 p-4">
              <p className="font-headline text-sm font-semibold text-emerald-300">
                ✓ Brain published on Sui
              </p>
              <p className="mt-1 font-mono text-[11px] text-on-surface-variant break-all">
                object id: {publishedId}
              </p>
              <p className="mt-2 text-xs text-on-surface-variant">
                Redirecting to your listing in 3s…{' '}
                <Link
                  href={`/marketplace/${publishedId}`}
                  className="text-primary underline hover:opacity-80"
                >
                  open now →
                </Link>
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
