'use client';

/**
 * KitBrowser — slide-in drawer listing the 7 web3 agent-kits registered via
 * PRD-T1. Read-only browse; sellers bind kits to an agent via SkillsPanel.
 *
 * Uses GET /v3/kits (feature-flagged). Closes on Escape + backdrop click.
 */

import { useEffect, useState } from 'react';

const API_BASE =
  process.env.NEXT_PUBLIC_AGENT_BACKEND_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001';

interface KitRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  homepage_url: string | null;
  license: string;
  leading_word: string;
  audit_score: number;
  npm_package: string | null;
  install_command: string | null;
}

interface Capability {
  capability_id: string;
  name: string;
  description: string | null;
  chains: string[];
  stablecoins: string[];
}

interface KitDetail {
  kit: KitRow;
  latest_version: { version: string; skill_md_url: string | null } | null;
  capabilities: Capability[];
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function KitBrowser({ open, onClose }: Props) {
  const [kits, setKits] = useState<KitRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, KitDetail>>({});

  useEffect(() => {
    if (!open || kits) return;
    fetch(`${API_BASE}/v3/kits`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`kits list failed (${r.status})`);
        const data = (await r.json()) as { kits: KitRow[] };
        setKits(data.kits);
      })
      .catch((e) => setError(e.message));
  }, [open, kits]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function toggle(slug: string) {
    if (expanded === slug) {
      setExpanded(null);
      return;
    }
    setExpanded(slug);
    if (!details[slug]) {
      try {
        const r = await fetch(`${API_BASE}/v3/kits/${encodeURIComponent(slug)}`);
        if (r.ok) {
          const detail = (await r.json()) as KitDetail;
          setDetails((prev) => ({ ...prev, [slug]: detail }));
        }
      } catch {
        /* silent — retry on next expand */
      }
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="Web3 agent-kit browser"
      onClick={onClose}
    >
      <aside
        className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-outline-variant/30 bg-surface px-5 py-3">
          <h2 className="font-headline text-lg font-semibold">Web3 agent-kits</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden>
              close
            </span>
          </button>
        </header>

        <div className="flex-1 p-5">
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
          {!kits && !error && <p className="text-sm text-on-surface-variant">Loading kits…</p>}
          {kits && kits.length === 0 && (
            <p className="text-sm text-on-surface-variant">
              No kits registered. Set FEATURE_AGENT_TRAINING_PIPELINE=true on the API + run
              <code className="mx-1 rounded bg-surface-container-low px-1 py-0.5 font-mono text-xs">
                npm run seed:kits
              </code>
              .
            </p>
          )}
          <ul className="space-y-3">
            {(kits ?? []).map((k) => {
              const isOpen = expanded === k.slug;
              const detail = details[k.slug];
              return (
                <li
                  key={k.id}
                  className="rounded-lg border border-outline-variant/30 bg-surface-container-low"
                >
                  <button
                    type="button"
                    onClick={() => toggle(k.slug)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    aria-expanded={isOpen}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-headline font-semibold">{k.name}</span>
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                          audit {Number(k.audit_score).toFixed(2)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-on-surface-variant">
                        {k.description}
                      </p>
                    </div>
                    <span
                      className="material-symbols-outlined text-on-surface-variant"
                      aria-hidden
                    >
                      {isOpen ? 'expand_less' : 'expand_more'}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-outline-variant/20 px-4 py-3 text-xs">
                      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
                        <dt className="text-on-surface-variant">Leading word</dt>
                        <dd className="font-mono">{k.leading_word}</dd>
                        <dt className="text-on-surface-variant">License</dt>
                        <dd>{k.license}</dd>
                        {k.install_command && (
                          <>
                            <dt className="text-on-surface-variant">Install</dt>
                            <dd className="font-mono">{k.install_command}</dd>
                          </>
                        )}
                        {detail?.latest_version && (
                          <>
                            <dt className="text-on-surface-variant">Version</dt>
                            <dd className="font-mono">{detail.latest_version.version}</dd>
                          </>
                        )}
                      </dl>
                      {detail && (
                        <div className="mt-3">
                          <div className="mb-1 text-on-surface-variant">
                            Capabilities ({detail.capabilities.length})
                          </div>
                          <ul className="space-y-1.5">
                            {detail.capabilities.map((c) => (
                              <li
                                key={c.capability_id}
                                className="rounded bg-surface px-3 py-2"
                              >
                                <div className="font-medium">{c.name}</div>
                                {c.description && (
                                  <div className="mt-0.5 text-on-surface-variant">
                                    {c.description}
                                  </div>
                                )}
                                {c.chains.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {c.chains.map((ch) => (
                                      <span
                                        key={ch}
                                        className="rounded-full bg-primary/5 px-2 py-0.5 font-mono text-[10px] text-primary"
                                      >
                                        {ch}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </aside>
    </div>
  );
}
