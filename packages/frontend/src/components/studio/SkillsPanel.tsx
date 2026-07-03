'use client';

/**
 * SkillsPanel — per-agent SKILL.md inventory + "Add skill" trigger.
 *
 * Uses:
 *   GET    /v3/agents/:id/skills                — list active skills
 *   DELETE /v3/agents/:id/skills/:slug         — archive (owner only)
 */

import { useCallback, useEffect, useState } from 'react';
import SkillUploadModal from './SkillUploadModal';

const API_BASE =
  process.env.NEXT_PUBLIC_AGENT_BACKEND_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001';

interface Skill {
  slug: string;
  name: string;
  description: string;
  leading_word: string;
  audit_score: number;
  source_type: 'manual' | 'llm_auto' | 'kit_derived';
  mapped_kits: string[];
}

interface Props {
  agentId: string;
  ownerAddress: string;
}

export default function SkillsPanel({ agentId, ownerAddress }: Props) {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const refetch = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/v3/agents/${encodeURIComponent(agentId)}/skills`);
      if (!r.ok) {
        // 501 = feature flag off — silent empty state is fine.
        if (r.status === 501) {
          setSkills([]);
          return;
        }
        throw new Error(`skills fetch failed (${r.status})`);
      }
      const data = (await r.json()) as { skills: Skill[] };
      setSkills(data.skills);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [agentId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function onDelete(slug: string, name: string): Promise<void> {
    if (!window.confirm(`Remove skill "${name}"? You can re-upload the same SKILL.md any time.`)) {
      return;
    }
    // Optimistic remove.
    const prev = skills;
    setSkills((s) => (s ? s.filter((x) => x.slug !== slug) : s));
    try {
      const r = await fetch(
        `${API_BASE}/v3/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(slug)}`,
        {
          method: 'DELETE',
          headers: { 'x-wallet-address': ownerAddress },
        },
      );
      if (!r.ok) throw new Error(`delete failed (${r.status})`);
    } catch (e) {
      setSkills(prev);
      setError((e as Error).message);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-outline-variant/20 bg-surface-container-low p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-on-surface-variant">
          Skills ({skills?.length ?? 0})
        </div>
        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs text-primary hover:bg-primary/20"
        >
          + Add skill
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-error">
          {error}
        </p>
      )}

      {skills === null ? (
        <p className="mt-2 text-xs text-on-surface-variant">Loading…</p>
      ) : skills.length === 0 ? (
        <p className="mt-2 text-xs text-on-surface-variant">
          No skills yet. Upload a SKILL.md to attach kit-driven capabilities.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {skills.map((s) => (
            <li
              key={s.slug}
              className="flex items-center justify-between gap-2 rounded bg-surface px-3 py-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                    audit {Number(s.audit_score).toFixed(2)}
                  </span>
                  <span className="font-mono text-[10px] text-on-surface-variant">
                    {s.leading_word}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-on-surface-variant">{s.description}</div>
                {s.mapped_kits.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {s.mapped_kits.map((k) => (
                      <span
                        key={k}
                        className="rounded-full bg-secondary/10 px-2 py-0.5 font-mono text-[10px] text-secondary"
                      >
                        {k}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onDelete(s.slug, s.name)}
                className="rounded-full border border-outline-variant/40 px-2 py-1 text-on-surface-variant hover:border-error/40 hover:text-error"
                title="Remove skill"
              >
                <span className="material-symbols-outlined text-[14px]" aria-hidden>
                  delete
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <SkillUploadModal
        open={uploadOpen}
        agentId={agentId}
        ownerAddress={ownerAddress}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => {
          setUploadOpen(false);
          void refetch();
        }}
      />
    </div>
  );
}
