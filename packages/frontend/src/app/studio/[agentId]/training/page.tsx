'use client';

/**
 * /studio/[agentId]/training — V3 Training Pipeline (PRD-V V3).
 *
 * Composes: horizontal Stage 0-4 progression viz + EvalScorecard
 * (empty-state MVP per C11) + SkillsPanel (Jul 3 reuse) +
 * SkillUploadModal (Jul 3 reuse) + kit dependencies (from /introspect).
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useActiveWallet } from '@/hooks/useActiveWallet';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import SkillsPanel from '@/components/studio/SkillsPanel';
import SkillUploadModal from '@/components/studio/SkillUploadModal';
import { EvalScorecard } from '@/components/studio/EvalScorecard';

interface IntrospectSkill {
  slug: string;
  audit_score: number;
  audit_last_run: string | null;
  status: string;
}
interface IntrospectKit {
  slug: string;
  name: string;
  capability_ids: string[];
}
interface IntrospectView {
  agent: { id: string; slug: string };
  skills: IntrospectSkill[];
  kits: IntrospectKit[];
}

const STAGE_ROWS = [
  { stage: 0, title: 'Onboarded', hint: 'Agent row exists' },
  { stage: 1, title: 'SkillsAdded', hint: '≥ 1 active skill' },
  { stage: 2, title: 'Evaluated', hint: 'Audit within 30 days' },
  { stage: 3, title: 'Orchestrator', hint: 'Completed a sub-hire' },
  { stage: 4, title: 'Dreamed', hint: 'Approved a dream cycle' },
];

export default function TrainingPage(): JSX.Element {
  const { agentId } = useParams<{ agentId: string }>();
  const { authenticated, ready } = usePrivy();
  const { address } = useActiveWallet();

  const [stage, setStage] = useState<number>(0);
  const [view, setView] = useState<IntrospectView | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !authenticated || !address || !agentId) return;
    let cancelled = false;
    (async () => {
      try {
        // 1) Overview → training_stage
        const oRes = await fetch(`${AGENT_BACKEND_URL}/v3/studio/agents/${agentId}`, {
          headers: { 'x-wallet-address': address },
        });
        if (oRes.ok) {
          const body = (await oRes.json()) as { training_stage: number };
          if (!cancelled) setStage(body.training_stage);
        }
        // 2) Introspect → skills + kits (public read; no wallet header needed)
        const iRes = await fetch(`${AGENT_BACKEND_URL}/v3/agents/${agentId}/introspect`);
        if (iRes.ok) {
          const body = (await iRes.json()) as IntrospectView;
          if (!cancelled) setView(body);
        } else {
          if (!cancelled) setError(`introspect: HTTP ${iRes.status}`);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, address, agentId, reloadTick]);

  if (!authenticated || !address) return <div>Sign in required.</div>;

  const activeSkills = (view?.skills ?? []).filter((s) => s.status === 'active');
  const kits = view?.kits ?? [];

  return (
    <div className="space-y-6">
      {/* Stage progression viz — horizontal 5-card layout, current highlighted */}
      <div>
        <h2 className="mb-3 font-headline text-lg font-semibold">Training stage</h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {STAGE_ROWS.map((s) => {
            const done = s.stage < stage;
            const current = s.stage === stage;
            return (
              <div
                key={s.stage}
                className={`rounded-xl border p-3 text-center ${
                  current
                    ? 'border-primary bg-primary/10'
                    : done
                    ? 'border-secondary/40 bg-secondary/10 opacity-90'
                    : 'border-outline-variant/40 bg-surface-container-low opacity-70'
                }`}
              >
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-on-surface-variant">
                  Stage {s.stage}
                </div>
                <div className={`font-semibold ${current ? 'text-primary' : ''}`}>
                  {s.title}
                  {done && <span className="ml-1" aria-hidden>✓</span>}
                </div>
                <div className="mt-1 text-[11px] text-on-surface-variant">{s.hint}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Eval scorecard */}
      <EvalScorecard
        skills={activeSkills.map((s) => ({
          slug: s.slug,
          audit_score: s.audit_score,
          audit_last_run: s.audit_last_run,
        }))}
      />

      {/* Skills panel + upload */}
      <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-headline text-sm font-semibold">SKILL.md inventory</h3>
          <button
            onClick={() => setUploadOpen(true)}
            className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-on-primary hover:opacity-90"
          >
            + Upload SKILL.md
          </button>
        </div>
        <SkillsPanel agentId={agentId} ownerAddress={address} />
      </div>

      {/* Kit dependencies */}
      <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-5">
        <h3 className="mb-3 font-headline text-sm font-semibold">Kit dependencies</h3>
        {kits.length === 0 ? (
          <p className="text-sm text-on-surface-variant">
            No web3 kits bound yet. Skills that use kit capabilities (n-payment, xrpl-builder, etc.)
            will surface here after upload.
          </p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {kits.map((k) => (
              <li
                key={k.slug}
                className="rounded-lg border border-outline-variant/40 bg-surface-container/50 px-3 py-2 text-sm"
              >
                <div className="font-mono text-xs text-on-surface-variant">{k.slug}</div>
                <div className="font-medium">{k.name}</div>
                {k.capability_ids.length > 0 && (
                  <div className="mt-1 truncate text-[11px] text-on-surface-variant">
                    Capabilities: {k.capability_ids.join(', ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-error/40 bg-error/5 px-4 py-2 text-sm text-error">
          {error}
        </div>
      )}

      <SkillUploadModal
        open={uploadOpen}
        agentId={agentId}
        ownerAddress={address}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => {
          setUploadOpen(false);
          setReloadTick((t) => t + 1);
        }}
      />
    </div>
  );
}
