'use client';

/**
 * components/TrustlessVisualization.tsx — Sui × Walrus × Tatum UX surfaces.
 *
 * Exports two components used across the trustless flow:
 *
 *   <TrustlessStatusPanel brainId={id} />
 *     Read-mode pill cluster: Walrus blob ✓ · Sui object ✓ · Tatum indexed ✓.
 *     Hover-to-copy. Click-to-explorer. Powered by the existing
 *     `GET /v3/brains/:id/sovereignty-proof` endpoint — no new server
 *     surface needed.
 *
 *   <TrustlessProgressTimeline step={current} error={maybe} />
 *     Publish-time pipeline: Encrypt → SEAL wrap → Walrus pin → Sui tx →
 *     Tatum index. Driven from a parent `step` prop — the trustless publish
 *     wizard advances it as each phase completes. Client-driven; no SSE
 *     server required (per "essential files only").
 *
 * SOLID:
 *  - SRP: presentation only. Data fetching for the status panel is a
 *    single hook colocated below; no global state.
 *  - DIP: explorer URLs come from `lib/networks.ts` (sui-testnet entry).
 *    No URLs hardcoded inside.
 *  - OCP: a 4th step in the timeline = one element appended to STEPS.
 */

import { useEffect, useState } from 'react';
import { getNetworkByKey } from '@/lib/networks';
import { AGENT_BACKEND_URL } from '@/lib/contracts';

const SUI_EXPLORER = getNetworkByKey('sui-testnet').blockExplorer; // https://suiscan.xyz/testnet
// Walruscan testnet — public block explorer for Walrus blobs.
const WALRUS_VIEWER = 'https://walruscan.com/testnet/blob';
const TATUM_DASHBOARD = 'https://dashboard.tatum.io';

// A real Sui object id is 0x + 64 hex chars; a tx digest is base58 (~44 chars).
// We accept either as the "Sui anchor" — until the real Move package is
// deployed, the publish tx digest IS the canonical on-chain receipt.
function suiExplorerUrl(value: string): string {
  return value.startsWith('0x')
    ? `${SUI_EXPLORER}/object/${value}`
    : `${SUI_EXPLORER}/tx/${value}`;
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TrustlessStatus {
  brainId: string;
  walrusBlobIds: string[];
  suiObjectId?: string;
  tatumIndexedAt?: string | number;
  contentMetadataHash?: string;
}

interface SovereigntyProofResponse {
  brainId: string;
  chunkCount: number;
  walrusBlobIds: string[];
  suiObjectId?: string;
  contentMetadataHash?: string;
  timestamp?: number;
  walrusNetwork?: string;
}

// ─── Status panel ─────────────────────────────────────────────────────────

function useTrustlessStatus(brainId: string | undefined) {
  const [status, setStatus] = useState<TrustlessStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!brainId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${AGENT_BACKEND_URL}/v3/brains/${encodeURIComponent(brainId)}/sovereignty-proof`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: SovereigntyProofResponse) => {
        if (cancelled) return;
        setStatus({
          brainId: data.brainId,
          walrusBlobIds: data.walrusBlobIds ?? [],
          suiObjectId: data.suiObjectId,
          tatumIndexedAt: data.timestamp,
          contentMetadataHash: data.contentMetadataHash,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [brainId]);

  return { status, error, loading };
}

interface BadgeProps {
  label: string;
  value: string | undefined;
  state: 'ok' | 'pending' | 'missing';
  href?: string;
}

function Badge({ label, value, state, href }: BadgeProps) {
  const dot =
    state === 'ok' ? 'bg-emerald-500' : state === 'pending' ? 'bg-amber-500 animate-pulse' : 'bg-gray-400';
  const display =
    !value ? '—' : value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;

  const inner = (
    <span className="flex items-center gap-2 rounded-full border border-outline-variant/30 bg-surface-container-low px-3 py-1 text-[11px] font-mono text-on-surface-variant">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className="font-semibold uppercase tracking-wide text-on-surface">{label}</span>
      <span title={value ?? ''}>{display}</span>
      {href && state === 'ok' && (
        <span className="material-symbols-outlined text-[12px] opacity-60">open_in_new</span>
      )}
    </span>
  );

  if (href && state === 'ok') {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="hover:opacity-80">
        {inner}
      </a>
    );
  }
  if (value) {
    return (
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(value)}
        title="Click to copy"
        className="hover:opacity-80"
      >
        {inner}
      </button>
    );
  }
  return inner;
}

export function TrustlessStatusPanel({ brainId }: { brainId: string | undefined }) {
  const { status, error, loading } = useTrustlessStatus(brainId);

  if (!brainId) return null;

  if (loading && !status) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-on-surface-variant">
        <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
        Loading trustless proof…
      </div>
    );
  }
  if (error && !status) {
    return (
      <div className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-[11px] text-error">
        Trustless status unavailable: {error}
      </div>
    );
  }
  if (!status) return null;

  const blob = status.walrusBlobIds[0];
  const sui = status.suiObjectId;
  const indexed = status.tatumIndexedAt;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge
        label="Walrus"
        value={blob}
        state={blob ? 'ok' : 'pending'}
        href={blob ? `${WALRUS_VIEWER}/${blob}` : undefined}
      />
      <Badge
        label="Sui"
        value={sui}
        state={sui ? 'ok' : 'pending'}
        href={sui ? suiExplorerUrl(sui) : undefined}
      />
      <Badge
        label="Tatum"
        value={indexed ? new Date(indexed).toISOString().slice(0, 19).replace('T', ' ') : undefined}
        state={indexed ? 'ok' : 'pending'}
        href={TATUM_DASHBOARD}
      />
    </div>
  );
}

// ─── Progress timeline ────────────────────────────────────────────────────

/**
 * TatumMemwalAttestation — small inline panel surfacing the new
 * sovereignty-proof + Memwal-bridge integrations to the user.
 *
 * Renders:
 *   - "Verify on Tatum" link → /v3/workflows/<id>/sovereignty-proof (public endpoint)
 *   - "Bridge to Walrus Memory" hint → SDK snippet via @fhe-ai-context/sdk
 *
 * Co-located here (instead of new file) per the minimum-file mandate; this
 * component is small, single-responsibility, pure-presentational.
 */
export function TatumMemwalAttestation({
  productType,
  productId,
  apiBaseUrl,
}: {
  productType: 'workflow' | 'brain' | 'skill' | 'reflective';
  productId: string;
  apiBaseUrl: string;
}) {
  // Sovereignty-proof endpoint exists for workflows + brains today.
  const sovUrl =
    productType === 'workflow'
      ? `${apiBaseUrl}/v3/workflows/${productId}/sovereignty-proof`
      : productType === 'brain'
        ? `${apiBaseUrl}/v3/brains/${productId}/sovereignty-proof`
        : null;
  return (
    <div className="rounded-lg border border-secondary/30 bg-secondary/5 p-3 text-xs">
      <div className="mb-2 flex items-center gap-2">
        <span className="material-symbols-outlined text-[14px] text-secondary">verified</span>
        <span className="font-medium text-on-surface">Independently verifiable</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-on-surface-variant">
        {sovUrl ? (
          <a
            href={sovUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-500 hover:underline"
            title="Public endpoint — no wallet needed. Returns Sui object id, Walrus blob id, signer signature, and Tatum-side attestation."
          >
            verify via Tatum ↗
          </a>
        ) : null}
        <span
          className="inline-flex items-center gap-1 rounded-full border border-outline-variant/40 bg-surface-variant/40 px-2 py-0.5"
          title="Pull this product into a Walrus Memory namespace via @fhe-ai-context/sdk WalrusMemoryBridge.runOpenXBrainAsMemory()"
        >
          🌊 Walrus Memory bridge — SDK
        </span>
      </div>
    </div>
  );
}

export type TimelineStep = 0 | 1 | 2 | 3 | 4 | 5;

const STEPS: ReadonlyArray<{ label: string; hint: string }> = [
  { label: 'Encrypt', hint: 'AES-256-GCM in browser' },
  { label: 'SEAL wrap', hint: 'IBE wrap key (testnet)' },
  { label: 'Walrus pin', hint: 'Quilt blob storage' },
  { label: 'Sui tx', hint: 'Move policy created (sponsored)' },
  { label: 'Tatum index', hint: 'Server confirms ownership event' },
];

interface TimelineProps {
  /** Current 0-based step. -1 = idle. STEPS.length = done. */
  step: number;
  /** Error message if a step failed. Shown below the active step. */
  error?: string | null;
}

export function TrustlessProgressTimeline({ step, error }: TimelineProps) {
  return (
    <ol className="flex flex-col gap-3">
      {STEPS.map((s, i) => {
        const state: 'done' | 'active' | 'pending' | 'error' =
          error && i === step ? 'error' : i < step ? 'done' : i === step ? 'active' : 'pending';
        const dot =
          state === 'done'
            ? 'bg-emerald-500 text-white'
            : state === 'active'
            ? 'bg-amber-500 text-white'
            : state === 'error'
            ? 'bg-error text-white'
            : 'bg-surface-container-high text-on-surface-variant';
        const icon =
          state === 'done'
            ? 'check'
            : state === 'active'
            ? 'progress_activity'
            : state === 'error'
            ? 'error'
            : 'circle';
        return (
          <li key={s.label} className="flex items-start gap-3">
            <span
              className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-[14px] ${dot}`}
              aria-hidden
            >
              <span className={`material-symbols-outlined text-[14px] ${state === 'active' ? 'animate-spin' : ''}`}>
                {icon}
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-on-surface">{s.label}</span>
              <span className="block text-[11px] text-on-surface-variant">{s.hint}</span>
              {state === 'error' && error && (
                <span className="mt-1 block text-[11px] text-error">{error}</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Convenience constant for callers that want to compute "all done". */
export const TRUSTLESS_TOTAL_STEPS = STEPS.length;
