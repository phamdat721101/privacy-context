'use client';

/**
 * OnboardPanel — Agent Training Pipeline Stage 1 UX inside /studio?tab=onboard.
 *
 * Extracted from the standalone /onboard route so we can retire that route
 * (redirect to /studio?tab=onboard) and consolidate the seller journey into
 * a single tabbed surface.
 */

import { useState } from 'react';

const API_BASE =
  process.env.NEXT_PUBLIC_AGENT_BACKEND_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001';

const EXAMPLE_PROMPT =
  'My agent translates English to Vietnamese, priced at $0.05 per query, ' +
  'hosted at https://my-translator.example.com/api. Operator email: alice@example.com.';

type OnboardLive = {
  status: 'live';
  agent_id: string;
  slug: string;
  agent_url: string;
  paywall_url: string;
  curl_example: string;
  message: string;
};
type OnboardClarify = { status: 'needs_clarification'; message: string; missing_fields: string[] };
type OnboardError = { error: string; message?: string };
type OnboardResult = OnboardLive | OnboardClarify | OnboardError;

export default function OnboardPanel() {
  const [prompt, setPrompt] = useState('');
  const [operatorEmail, setOperatorEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OnboardResult | null>(null);

  async function submit() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/v3/concierge/onboard`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, operator_email: operatorEmail || undefined }),
      });
      setResult((await res.json()) as OnboardResult);
    } catch (err) {
      setResult({ error: 'network_error', message: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  const isLive = result && 'status' in result && result.status === 'live';
  const isClarify = result && 'status' in result && result.status === 'needs_clarification';
  const isError = result && 'error' in result;

  return (
    <section className="space-y-6 rounded-xl border border-outline-variant/30 bg-surface p-6">
      <header className="space-y-1">
        <h2 className="font-headline text-xl font-semibold">Publish your AI agent on OpenX</h2>
        <p className="text-sm text-on-surface-variant">
          Describe your agent in one sentence — we&apos;ll put it live in about 10 seconds. You host the
          agent; OpenX handles the marketplace, paywall, and discovery.
        </p>
      </header>

      <label className="block">
        <span className="text-sm font-medium">Describe your agent</span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={EXAMPLE_PROMPT}
          className="mt-1 block h-36 w-full rounded-md border border-outline-variant/40 bg-surface-container-low p-3 text-sm focus:border-primary focus:outline-none"
          maxLength={2000}
        />
        <span className="mt-1 block text-xs text-on-surface-variant">{prompt.length} / 2000</span>
      </label>

      <label className="block">
        <span className="text-sm font-medium">Operator email (optional)</span>
        <input
          type="email"
          value={operatorEmail}
          onChange={(e) => setOperatorEmail(e.target.value)}
          placeholder="you@example.com"
          className="mt-1 block w-full rounded-md border border-outline-variant/40 bg-surface-container-low p-2 text-sm focus:border-primary focus:outline-none"
        />
        <span className="mt-1 block text-xs text-on-surface-variant">
          Used to notify you when earnings exceed $1 USDC.
        </span>
      </label>

      <button
        onClick={submit}
        disabled={loading || prompt.trim().length < 30}
        className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-on-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? 'Publishing… (~10s)' : 'Publish my agent'}
      </button>

      {isLive && (
        <div className="rounded-lg border-l-4 border-green-500 bg-green-50 p-5 text-sm text-green-900">
          <div className="font-semibold">✓ Your agent is live</div>
          <p className="mt-1">{(result as OnboardLive).message}</p>
          <dl className="mt-3 space-y-1 font-mono text-xs">
            <div>
              <dt className="inline text-green-800">agent_id:</dt>{' '}
              <dd className="inline">{(result as OnboardLive).agent_id}</dd>
            </div>
            <div>
              <dt className="inline text-green-800">paywall_url:</dt>{' '}
              <dd className="inline">{(result as OnboardLive).paywall_url}</dd>
            </div>
          </dl>
        </div>
      )}

      {isClarify && (
        <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-semibold">Needs more detail</div>
          <p className="mt-1">{(result as OnboardClarify).message}</p>
          <ul className="mt-2 list-disc pl-6 text-xs">
            {(result as OnboardClarify).missing_fields.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {isError && (
        <div className="rounded-lg border-l-4 border-red-500 bg-red-50 p-4 text-sm text-red-900">
          <div className="font-semibold">Error</div>
          <p className="mt-1">{(result as OnboardError).message ?? (result as OnboardError).error}</p>
        </div>
      )}
    </section>
  );
}
