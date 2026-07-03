'use client';

/**
 * SkillUploadModal — paste-or-file SKILL.md upload dialog.
 *
 * POSTs multipart-JSON to /v3/agents/:id/skills. On 400 with an `audit`
 * payload, renders the four-pillar failure reasons inline so the seller
 * can fix and retry without leaving the modal.
 */

import { useEffect, useState } from 'react';

const API_BASE =
  process.env.NEXT_PUBLIC_AGENT_BACKEND_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001';

const EXAMPLE = `---
name: xrpl-rlusd-balance
slug: xrpl-rlusd-balance
description: Return the RLUSD balance on XRPL for a given wallet address.
leading_word: fetchWithPayment
trigger_type: user
trigger_patterns: [rlusd, xrpl balance, xrpl rlusd]
kits: [n-payment, xrpl-builder]
---

# xrpl-rlusd-balance

Fetch RLUSD balance on XRPL for a wallet address.

## Steps
1. Ask the user for the XRPL classic address.
2. Call \`fetchWithPayment\` against the OpenX xrpl-rlusd-balance endpoint.
3. Return the balance and the settlement tx hash.
`;

interface AuditPayload {
  score: number;
  pass: boolean;
  pillars: Record<string, boolean>;
  reasons: string[];
}

interface Props {
  open: boolean;
  agentId: string;
  ownerAddress: string;
  onClose: () => void;
  onUploaded: () => void;
}

export default function SkillUploadModal({ open, agentId, ownerAddress, onClose, onUploaded }: Props) {
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState<AuditPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setContent('');
      setAudit(null);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setContent(text);
    e.target.value = '';
  }

  async function submit(): Promise<void> {
    if (!content.trim()) {
      setError('SKILL.md content is empty');
      return;
    }
    setBusy(true);
    setError(null);
    setAudit(null);
    try {
      const r = await fetch(`${API_BASE}/v3/agents/${encodeURIComponent(agentId)}/skills`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-wallet-address': ownerAddress,
        },
        body: JSON.stringify({ skill_md_content: content }),
      });
      const body = (await r.json()) as {
        error?: string;
        audit?: AuditPayload;
        skill?: { slug: string };
      };
      if (!r.ok) {
        if (body.audit) setAudit(body.audit);
        setError(body.error ?? `upload failed (${r.status})`);
        return;
      }
      onUploaded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Upload SKILL.md"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-xl bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-outline-variant/30 px-5 py-3">
          <h3 className="font-headline text-lg font-semibold">Upload SKILL.md</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full p-1 text-on-surface-variant hover:bg-surface-container-low"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden>
              close
            </span>
          </button>
        </header>

        <div className="space-y-3 p-5 text-sm">
          <p className="text-on-surface-variant">
            Paste a Pocock-quality SKILL.md (≤200 lines, one leading word, description ≥20 chars).
          </p>

          <div className="flex items-center gap-3">
            <label className="cursor-pointer rounded-full border border-outline-variant/40 px-3 py-1.5 text-xs hover:border-primary/40 hover:text-primary">
              Choose file
              <input type="file" accept=".md,.markdown,text/markdown" onChange={onPickFile} className="hidden" />
            </label>
            <button
              type="button"
              onClick={() => setContent(EXAMPLE)}
              className="text-xs text-on-surface-variant underline-offset-2 hover:text-primary hover:underline"
            >
              Load example
            </button>
          </div>

          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="---\nname: my-skill\n..."
            className="block h-64 w-full rounded-md border border-outline-variant/40 bg-surface-container-low p-3 font-mono text-xs focus:border-primary focus:outline-none"
          />

          {audit && !audit.pass && (
            <div className="rounded-md border-l-4 border-amber-500 bg-amber-50 p-3 text-xs text-amber-900">
              <div className="font-semibold">Audit score {audit.score.toFixed(2)} — fix these:</div>
              <ul className="mt-1 list-disc pl-6">
                {audit.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {error && !audit && (
            <p role="alert" className="text-xs text-error">
              {error}
            </p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-outline-variant/30 bg-surface-container-low px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-outline-variant/40 px-4 py-1.5 text-xs text-on-surface-variant hover:bg-surface"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !content.trim()}
            className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-on-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Uploading…' : 'Upload skill'}
          </button>
        </footer>
      </div>
    </div>
  );
}
