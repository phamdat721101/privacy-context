'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { useUploadBrain } from '@/hooks/useUploadBrain';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import { createLogger } from '@/lib/clientLogger';

const log = createLogger('publishPage');

const STEP_COPY: Record<string, string> = {
  idle: 'Ready to publish.',
  encrypting: '🔒 Encrypting in your browser…',
  'wrapping-key': '🔐 Wrapping the key on-chain…',
  'storing-key': '✍️ Sign the on-chain key (one tx)…',
  uploading: '📤 Uploading encrypted ciphertext…',
  done: '✅ Brain published.',
  error: '❌ Something went wrong.',
};

const SAMPLE = "I built a Solidity FHE contract on Arbitrum — ask me anything about secure FHE patterns.";
const DEFAULT_PERSONA = 'You are a confidential second brain. Answer ONLY from the provided sources.';

interface DoneState {
  brainId: number;
  agentId: string | null;
}

export default function PublishPage() {
  const { authenticated, user, login } = usePrivy();
  const wallet = user?.wallet?.address;
  const { upload, step, error } = useUploadBrain();

  // Simple flow (always visible)
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState('');

  // Advanced flow (disclosure)
  const [advanced, setAdvanced] = useState(false);
  const [tier, setTier] = useState<'standard' | 'trustless'>('standard');
  const [persona, setPersona] = useState(DEFAULT_PERSONA);
  const [model, setModel] = useState('gpt-4o-mini');
  const [tools, setTools] = useState('');
  const [pricing, setPricing] = useState({ x402: '0.01', mpp: '0.01', sui_usdc: '' });
  const [kyaRequired, setKyaRequired] = useState(false);
  const [minRep, setMinRep] = useState(0);

  const [agentErr, setAgentErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<DoneState | null>(null);

  const onSubmit = async () => {
    if (!authenticated) return login();
    if (!content.trim()) return;
    setSubmitting(true);
    setAgentErr(null);

    try {
      // 1) Publish the encrypted brain (existing v2 flow — fixed in Fix 2).
      const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
      const r = await upload(content, undefined, {
        title: title.trim() || content.slice(0, 60),
        description: content.slice(0, 200),
        tags: tagList,
      });
      log.info('brain:published', { brainId: r?.brainId });

      let agentId: string | null = null;

      // 2) (Advanced only) wrap as a v3 agent. Soft-fail if API doesn't have v3 yet.
      if (advanced && r?.brainId && wallet) {
        try {
          const created = await fetch(`${AGENT_BACKEND_URL}/v3/agents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-wallet-address': wallet },
            body: JSON.stringify({
              brain_id: r.brainId,
              chain: tier === 'trustless' ? 'sui' : 'fhenix',
              persona: {
                system_prompt: persona,
                tools: tools.split(',').map((t) => t.trim()).filter(Boolean),
                model,
              },
              pricing: {
                x402: pricing.x402 || null,
                mpp: pricing.mpp || null,
                sui_usdc: pricing.sui_usdc || null,
              },
              kya_required: kyaRequired,
              min_reputation: minRep,
            }),
          });
          if (!created.ok) {
            const body = await created.text().catch(() => '');
            throw new Error(`agent create ${created.status}: ${body}`);
          }
          const agent = await created.json();
          await fetch(`${AGENT_BACKEND_URL}/v3/agents/${agent.id}/publish`, {
            method: 'POST',
            headers: { 'x-wallet-address': wallet },
          });
          agentId = agent.id;
          log.info('agent:published', { agentId });
        } catch (e: any) {
          log.warn('agent:create:failed', { err: e?.message });
          setAgentErr(
            `Brain saved, but agent setup failed: ${e?.message ?? e}. ` +
            `The API may be on an older build — restart it after applying the migration.`,
          );
        }
      }

      setDone({ brainId: r.brainId, agentId });
    } catch (e: any) {
      log.error('submit:failed', e);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 py-12">
        <div className="rounded-xl border border-secondary/40 bg-secondary/5 p-8 text-center">
          <div className="mb-4 text-5xl">🎉</div>
          <h1 className="font-headline text-3xl font-bold">You're earning.</h1>
          <p className="mt-2 text-on-surface-variant">
            Brain #{done.brainId} is live
            {done.agentId && (
              <>
                {' '}— agent <code className="font-mono text-xs">{done.agentId.slice(0, 8)}…</code>
              </>
            )}
            .
          </p>
          {agentErr && <p className="mt-3 text-sm text-amber-500">{agentErr}</p>}
          <p className="mt-4 text-sm text-text-muted">
            🔒 Your data was AES-encrypted in this browser. The key is FHE-wrapped on Arbitrum.
            The platform cannot read your knowledge.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Link
            href="/earnings"
            className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 text-center font-medium text-primary hover:bg-primary/20"
          >
            See earnings →
          </Link>
          <Link
            href="/marketplace"
            className="rounded-lg border border-outline-variant/40 px-4 py-3 text-center hover:border-primary/40"
          >
            Marketplace
          </Link>
          <button
            type="button"
            onClick={() => {
              setContent('');
              setTitle('');
              setTags('');
              setDone(null);
              setAgentErr(null);
            }}
            className="rounded-lg border border-outline-variant/40 px-4 py-3 text-on-surface-variant hover:border-primary/40"
          >
            + Publish another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <header className="space-y-2">
        <h1 className="font-headline text-3xl font-bold md:text-4xl">
          Get paid when AI agents query <span className="text-primary">your brain</span>.
        </h1>
        <p className="text-on-surface-variant">
          One sentence. We encrypt it in your browser, wrap the key on-chain, and list it at
          $0.01 per query. The platform can't read it.
        </p>
      </header>

      <div className="space-y-4 rounded-xl border border-outline-variant/30 bg-surface p-6">
        <div>
          <label className="mb-1 block text-sm text-on-surface-variant">What do you know?</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={SAMPLE}
            rows={4}
            className="w-full rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2 text-on-surface focus:border-primary/60 focus:outline-none"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-on-surface-variant">Title (optional)</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Solidity FHE 101"
              className="w-full rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2 text-on-surface focus:border-primary/60 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-on-surface-variant">Tags (comma-separated)</label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="solidity, fhe, security"
              className="w-full rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2 text-on-surface focus:border-primary/60 focus:outline-none"
            />
          </div>
        </div>

        <details
          open={advanced}
          onToggle={(e) => setAdvanced((e.target as HTMLDetailsElement).open)}
          className="rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm"
        >
          <summary className="cursor-pointer text-on-surface-variant">
            Advanced agent settings (persona · pricing · KYA)
          </summary>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTier('standard')}
                className={`rounded border p-2 text-xs ${
                  tier === 'standard' ? 'border-primary bg-primary/10' : 'border-outline-variant/40'
                }`}
              >
                Standard (Fhenix)
              </button>
              <button
                type="button"
                onClick={() => setTier('trustless')}
                className={`rounded border p-2 text-xs ${
                  tier === 'trustless' ? 'border-primary bg-primary/10' : 'border-outline-variant/40'
                }`}
              >
                Trustless (Sui)
              </button>
            </div>

            <textarea
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              rows={3}
              className="w-full rounded border border-outline-variant/40 bg-surface px-2 py-1 text-xs"
            />

            <div className="grid grid-cols-2 gap-2">
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="model: gpt-4o-mini"
                className="rounded border border-outline-variant/40 bg-surface px-2 py-1 text-xs"
              />
              <input
                value={tools}
                onChange={(e) => setTools(e.target.value)}
                placeholder="tools: search, calc"
                className="rounded border border-outline-variant/40 bg-surface px-2 py-1 text-xs"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <input
                value={pricing.x402}
                onChange={(e) => setPricing({ ...pricing, x402: e.target.value })}
                placeholder="x402 USDC"
                className="rounded border border-outline-variant/40 bg-surface px-2 py-1 text-xs"
              />
              <input
                value={pricing.mpp}
                onChange={(e) => setPricing({ ...pricing, mpp: e.target.value })}
                placeholder="MPP USDC"
                className="rounded border border-outline-variant/40 bg-surface px-2 py-1 text-xs"
              />
              <input
                value={pricing.sui_usdc}
                onChange={(e) => setPricing({ ...pricing, sui_usdc: e.target.value })}
                placeholder="Sui USDC"
                className="rounded border border-outline-variant/40 bg-surface px-2 py-1 text-xs"
              />
            </div>

            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={kyaRequired}
                onChange={(e) => setKyaRequired(e.target.checked)}
              />
              Require ERC-8004 verified agent
            </label>
            {kyaRequired && (
              <input
                type="number"
                value={minRep}
                onChange={(e) => setMinRep(Number(e.target.value))}
                className="w-32 rounded border border-outline-variant/40 bg-surface px-2 py-1 text-xs"
                placeholder="min reputation"
              />
            )}
          </div>
        </details>

        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || !content.trim()}
          className="w-full rounded-full bg-primary px-5 py-3 font-medium text-on-primary transition-colors hover:opacity-90 disabled:opacity-50"
        >
          {!authenticated
            ? 'Sign in & publish'
            : submitting
              ? STEP_COPY[step] ?? 'Publishing…'
              : 'Publish & start earning'}
        </button>

        {error && (
          <div className="rounded-lg border border-error/40 bg-error/5 p-3 text-sm text-error">
            <div className="font-semibold">Publish failed</div>
            <div className="mt-1">{error}</div>
            <div className="mt-2 text-xs text-on-surface-variant">
              Check the browser console — every step is logged with timing under{' '}
              <code className="font-mono">[useUploadBrain:flow-…]</code>.
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-outline-variant/30 bg-surface-container-low p-4 text-xs text-text-muted">
        <p className="mb-1 font-semibold text-on-surface-variant">How the privacy works</p>
        <ul className="space-y-1">
          <li>• Your text is AES-256-GCM encrypted in this browser tab.</li>
          <li>• The key is split + FHE-wrapped (euint128) and stored on Arbitrum Sepolia.</li>
          <li>• AI agents pay USDC to query — they get answers, never raw chunks.</li>
          <li>• Revoke any time. Cryptographic — not a database flag.</li>
        </ul>
      </div>
    </div>
  );
}
