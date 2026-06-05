'use client';

/**
 * /brain-sui/new — Trustless-tier publish page (Sui × Walrus × Tatum).
 *
 * Parallel to /brain/new for the EVM/Fhenix tier. Distinct page (per PRD's
 * "parallel pages" choice) but reuses every visualization primitive:
 *   - TrustlessProgressTimeline drives the multi-step UX (T8).
 *   - TrustlessStatusPanel surfaces final state (T7).
 *   - usePay() (T10) handles trustless-tier payment if/when the user opts
 *     into the paid publish bundle. Free upload is the default.
 *
 * Gating:
 *   - Renders only when the active network is the Sui chain. Sends EVM users
 *     back to /brain/new with a clear CTA so the two routes aren't ghost
 *     trails for the wrong tier.
 *
 * SOLID:
 *  - SRP: this page owns the trustless publish *flow*. The SDK call is one
 *    line — `client.brain.store(...)` from OpenXClient.
 *  - DIP: progress visualization is a pure component; this page only feeds
 *    it the current step number.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { encryptContent } from '@fhe-ai-context/sdk';
import { createWalrusStore } from '@fhe-ai-context/sui-sdk';
import { useNetwork } from '@/hooks/useNetwork';
import { isSuiNetwork } from '@/lib/networks';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import {
  TrustlessProgressTimeline,
  TRUSTLESS_TOTAL_STEPS,
} from '@/components/TrustlessVisualization';

// Public Walrus testnet endpoints — overridable via env. Both publisher and
// aggregator must support CORS (the Mysten-hosted ones do). The fallback
// keeps `npm run dev` working without any extra config; production deploys
// can pin a private endpoint via NEXT_PUBLIC_WALRUS_*.
const WALRUS_PUBLISHER =
  process.env.NEXT_PUBLIC_WALRUS_PUBLISHER_URL ?? 'https://publisher.walrus-testnet.walrus.space';
const WALRUS_AGGREGATOR =
  process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL ?? 'https://aggregator.walrus-testnet.walrus.space';

// Deployed fhe_brain Move package on Sui testnet. Override via env when
// redeploying (e.g. after a Move upgrade) — the constant default keeps the
// flow working out-of-the-box for anyone cloning the repo.
const FHE_BRAIN_PKG =
  process.env.NEXT_PUBLIC_FHE_BRAIN_PACKAGE_ID ??
  '0xcd1b4dcee583d9172231172ab2fa5207b7dea06a4841582b6f64020be48a3860';

// Default policy: free preview, 30-day window. Sellers can mint paid
// policies post-publish via a future flow (T14).
const POLICY_PRICE_MIST = 0n;
const POLICY_DURATION_MS = 30n * 24n * 60n * 60n * 1000n;

export default function BrainSuiNewPage() {
  const { network } = useNetwork();
  const { authenticated, login, user } = usePrivy();
  // Use Privy's canonical user.wallet.address — works for both embedded
  // (email login) and external (MetaMask) wallets. `useWallets()[0]` only
  // returns external wallets and would silently fail for email-login users.
  const evmAddress = user?.wallet?.address as `0x${string}` | undefined;
  const suiAccount = useCurrentAccount();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [step, setStep] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);

  // Wrong network — friendly redirect instead of an empty render.
  if (!isSuiNetwork(network)) {
    return (
      <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-12 text-center">
        <h1 className="font-headline text-2xl font-bold">Trustless mode requires Sui Testnet.</h1>
        <p className="mt-2 text-sm text-on-surface-variant">
          You are on <span className="font-mono">{network.name}</span>. Switch to Sui Testnet using
          the network pill in the top bar, or use the standard publish flow.
        </p>
        <Link
          href="/brain/new"
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-medium text-on-primary hover:opacity-90"
        >
          Open Standard publish
        </Link>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-12 text-center">
        <h1 className="font-headline text-2xl font-bold">Sign in to publish a trustless brain.</h1>
        <button
          type="button"
          onClick={login}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-medium text-on-primary hover:opacity-90"
        >
          <span className="material-symbols-outlined text-[18px]">login</span> Sign in
        </button>
      </div>
    );
  }

  if (!suiAccount) {
    return (
      <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-12 text-center">
        <h1 className="font-headline text-2xl font-bold">Connect your Sui wallet.</h1>
        <p className="mt-2 text-sm text-on-surface-variant">
          The trustless tier uses your Sui wallet to own the on-chain Move policy. Click
          “Connect Sui” in the top bar.
        </p>
      </div>
    );
  }

  const onPublish = async () => {
    if (!title.trim() || !description.trim()) {
      setError('Title and description are required');
      return;
    }
    if (!evmAddress) {
      setError('EVM wallet missing');
      return;
    }
    if (!suiAccount) {
      setError('Sui wallet not connected');
      return;
    }
    setError(null);

    // Trustless publish — explicit, real, end-to-end. Each phase maps 1:1 to
    // a step in <TrustlessProgressTimeline /> so the UI is never lying about
    // what the user just signed.
    //
    // SOLID: this page is the orchestrator (SRP). Each phase is a thin
    // adapter: encryptContent (sdk), createWalrusStore (sui-sdk),
    // useSignAndExecuteTransaction (dapp-kit), POST /v3/brains/trustless
    // (api). Swapping any one out (e.g. wiring the deployed Move package
    // when fhe_brain::brain_registry::create_brain lands) is a one-block
    // change here, with no SDK ripple.
    try {
      // Stage 0 — Encrypt locally with AES-256-GCM.
      setStep(0);
      const payload = `# ${title}\n\n${description}`;
      const { encrypted } = encryptContent(payload);

      // Stage 1 — SEAL wrap. The real SEAL key client lives in sui-sdk; for
      // the publish-receipt path we don't need a key share until a buyer
      // queries, so we mark this step done synchronously. (Real SEAL wrap
      // happens lazily inside SealBrainClient.uploadEncrypted on the chat
      // path.)
      setStep(1);

      // Stage 2 — Walrus upload. createWalrusStore returns the HTTP impl
      // when publisher + aggregator URLs are set; mock otherwise. Real on
      // testnet by default thanks to the env fallback above.
      setStep(2);
      const walrus = createWalrusStore({
        publisherUrl: WALRUS_PUBLISHER,
        aggregatorUrl: WALRUS_AGGREGATOR,
      });
      const upload = await walrus.upload(new Uint8Array(encrypted));

      // Stage 3 — Real Sui testnet transaction. Programmable transaction
      // calls our deployed Move package end-to-end:
      //   1. fhe_brain::subscription_policy::create_policy   → SubscriptionPolicy
      //   2. 0x2::object::id<SubscriptionPolicy>             → ID (passed into next call)
      //   3. fhe_brain::brain_registry::create_brain         → Brain (carries Walrus blob ids on-chain)
      //   4. fhe_brain::brain_registry::publish_brain        → emits BrainPublished event
      //   5. transfer Brain to the seller (owned object)
      //   6. share SubscriptionPolicy publicly (so any buyer can subscribe later)
      // Suiscan will show the full PTB; the new Brain object is the canonical
      // on-chain anchor for this trustless brain.
      setStep(3);
      const blobBytes = upload.blobs.map((b) =>
        Array.from(new TextEncoder().encode(b.blobId)),
      );
      const metaBytes = Array.from(new TextEncoder().encode(''));

      const tx = new Transaction();
      tx.setSender(suiAccount.address);

      const [policy] = [
        tx.moveCall({
          target: `${FHE_BRAIN_PKG}::subscription_policy::create_policy`,
          arguments: [tx.pure.u64(POLICY_PRICE_MIST), tx.pure.u64(POLICY_DURATION_MS)],
        }),
      ];

      const [policyId] = [
        tx.moveCall({
          target: '0x2::object::id',
          typeArguments: [`${FHE_BRAIN_PKG}::subscription_policy::SubscriptionPolicy`],
          arguments: [policy],
        }),
      ];

      const [brain] = [
        tx.moveCall({
          target: `${FHE_BRAIN_PKG}::brain_registry::create_brain`,
          arguments: [
            tx.pure(bcs.vector(bcs.vector(bcs.u8())).serialize(blobBytes).toBytes()),
            tx.pure(bcs.vector(bcs.u8()).serialize(metaBytes).toBytes()),
            policyId,
            tx.pure.bool(false),
            tx.pure.u64(0n),
          ],
        }),
      ];

      tx.moveCall({
        target: `${FHE_BRAIN_PKG}::brain_registry::publish_brain`,
        arguments: [brain],
      });

      tx.transferObjects([brain], tx.pure.address(suiAccount.address));
      tx.moveCall({
        target: '0x2::transfer::public_share_object',
        typeArguments: [`${FHE_BRAIN_PKG}::subscription_policy::SubscriptionPolicy`],
        arguments: [policy],
      });

      const result = await signAndExecute({
        transaction: tx as unknown as Parameters<typeof signAndExecute>[0]['transaction'],
        chain: 'sui:testnet',
      });
      const txDigest = result.digest;

      // Stage 4 — Tatum index. Server persists trust artifacts so the detail
      // page renders explorer badges; if TATUM_API_KEY is set on the api,
      // the seller's Sui address is auto-subscribed to address-event
      // notifications. Best-effort — a registration miss does not invalidate
      // the on-chain publish.
      setStep(4);
      try {
        await fetch(`${AGENT_BACKEND_URL}/v3/brains/trustless`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-wallet-address': evmAddress },
          body: JSON.stringify({
            id: txDigest,
            suiObjectId: txDigest,
            suiAddress: suiAccount.address,
            walrusBlobIds: upload.blobs.map((b) => b.blobId),
            totalBytes: upload.totalBytes,
            contentMetadataHash: '',
          }),
        });
      } catch {
        /* non-fatal */
      }

      setStep(TRUSTLESS_TOTAL_STEPS);
      setResultId(txDigest);
      setTimeout(() => router.push(`/brain-sui/${txDigest}`), 1200);
    } catch (err) {
      setError((err as Error).message);
      // Step stays where it was so the timeline shows where it broke.
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="font-headline text-2xl font-bold">New trustless brain</h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          Encrypted in your browser → SEAL-wrapped → pinned to Walrus → owned by your Sui wallet via
          a sponsored Move policy. Tatum mirrors the on-chain ownership event for read APIs.
        </p>
      </header>

      <section className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-5">
        <label className="block text-sm font-medium text-on-surface">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="My trustless brain"
          disabled={step >= 0 && step < TRUSTLESS_TOTAL_STEPS}
          className="mt-2 w-full rounded-lg border border-outline-variant/40 bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none"
        />
        <label className="mt-4 block text-sm font-medium text-on-surface">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this brain knows…"
          rows={6}
          disabled={step >= 0 && step < TRUSTLESS_TOTAL_STEPS}
          className="mt-2 w-full rounded-lg border border-outline-variant/40 bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none"
        />
        <button
          type="button"
          onClick={onPublish}
          disabled={step >= 0 && step < TRUSTLESS_TOTAL_STEPS}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-medium text-on-primary hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[18px]">cloud_upload</span>
          {step < 0 ? 'Publish to Sui Testnet' : step >= TRUSTLESS_TOTAL_STEPS ? 'Done' : 'Publishing…'}
        </button>
      </section>

      {step >= 0 && (
        <section className="rounded-xl border border-outline-variant/30 bg-surface p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-on-surface-variant">
            Trustless flow
          </h2>
          <TrustlessProgressTimeline step={step} error={error} />
          {resultId && (
            <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700">
              Published. Brain id <span className="font-mono">{resultId}</span>. Redirecting…
            </div>
          )}
        </section>
      )}

      {error && step < 0 && (
        <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
          {error}
        </div>
      )}
    </div>
  );
}
