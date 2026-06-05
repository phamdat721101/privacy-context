'use client';

/**
 * ProofBundle — three-block attestation panel (Phala TEE + Sui billing + Walrus).
 *
 * Surfaced on:
 *  - the toast / modal after a paid recall completes
 *  - /verify/[txHash] standalone verifier page
 *  - dashboard activity rows
 *
 * Each block carries a public explorer link so the buyer can independently
 * verify without trusting OpenX. Layout: 1-col mobile, 3-col desktop.
 */

import type { ReactNode } from 'react';

export interface ProofBundleData {
  phala_tee_hash: string | null;
  sui_billing_tx_hash: string | null;
  walrus_blob_ids: string[];
  explorer_urls?: {
    sui?: string | null;
    walrus?: string[];
    phala?: string | null;
  };
}

interface BlockProps {
  title: string;
  iconColor: string;
  status: 'verified' | 'pending' | 'unavailable';
  rows: Array<{ label: string; value: ReactNode }>;
  link?: { url: string; label: string };
}

function StatusChip({ s }: { s: BlockProps['status'] }) {
  const map: Record<BlockProps['status'], string> = {
    verified: 'bg-secondary/10 border-secondary/30 text-secondary',
    pending: 'bg-amber-300/10 border-amber-300/30 text-amber-300',
    unavailable: 'bg-outline/10 border-outline/30 text-outline',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${map[s]}`}>
      {s === 'verified' && <span className="material-symbols-outlined text-[12px]">check_circle</span>}
      {s === 'pending' && <span className="material-symbols-outlined text-[12px]">pending</span>}
      {s === 'unavailable' && <span className="material-symbols-outlined text-[12px]">remove</span>}
      {s}
    </span>
  );
}

function ProofBlock({ title, iconColor, status, rows, link }: BlockProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-outline-variant/40 bg-surface-container-low/60 p-4 backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-headline text-base font-medium text-on-surface">
          <span className={`material-symbols-outlined ${iconColor} text-[20px]`}>verified</span>
          {title}
        </h3>
        <StatusChip s={status} />
      </div>
      <div className="flex flex-col gap-1.5 border-t border-outline-variant/30 pt-3 font-mono text-xs text-on-surface-variant">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between gap-2">
            <span className="text-outline">{r.label}</span>
            <span className="truncate text-on-surface">{r.value}</span>
          </div>
        ))}
      </div>
      {link && (
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-auto inline-flex items-center gap-1 text-xs text-primary transition hover:underline"
        >
          {link.label}
          <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
        </a>
      )}
    </div>
  );
}

function shortHash(s: string | null | undefined, headLen = 6, tailLen = 4): string {
  if (!s) return '—';
  if (s.length <= headLen + tailLen) return s;
  return `${s.slice(0, headLen)}…${s.slice(-tailLen)}`;
}

export function ProofBundle({ data }: { data: ProofBundleData }) {
  const sui = data.sui_billing_tx_hash;
  const phala = data.phala_tee_hash;
  const blobs = data.walrus_blob_ids ?? [];
  const sui_url = data.explorer_urls?.sui ?? (sui ? `https://suiscan.xyz/testnet/tx/${sui}` : null);
  const wal_urls = data.explorer_urls?.walrus ?? blobs.map((id) => `https://walruscan.com/blob/${id}`);
  const phala_url = data.explorer_urls?.phala ?? (phala ? `https://verifier.phala.network/?hash=${phala}` : null);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <ProofBlock
        title="Phala TEE"
        iconColor="text-secondary"
        status={phala ? 'verified' : 'unavailable'}
        rows={[
          { label: 'attestation', value: phala ? 'SIGNED' : '—' },
          { label: 'hash', value: <span title={phala ?? ''}>{shortHash(phala)}</span> },
        ]}
        link={phala_url ? { url: phala_url, label: 'verify on Phala' } : undefined}
      />
      <ProofBlock
        title="Sui Billing"
        iconColor="text-primary"
        status={sui ? 'verified' : 'pending'}
        rows={[
          { label: 'tx', value: <span title={sui ?? ''}>{shortHash(sui)}</span> },
          { label: 'network', value: 'testnet' },
        ]}
        link={sui_url ? { url: sui_url, label: 'view on Sui Explorer' } : undefined}
      />
      <ProofBlock
        title="Walrus Memory"
        iconColor="text-tertiary"
        status={blobs.length > 0 ? 'verified' : 'unavailable'}
        rows={[
          { label: 'blobs', value: blobs.length },
          {
            label: 'first blob',
            value: <span title={blobs[0] ?? ''}>{shortHash(blobs[0])}</span>,
          },
        ]}
        link={wal_urls[0] ? { url: wal_urls[0], label: 'view on Walruscan' } : undefined}
      />
    </div>
  );
}
