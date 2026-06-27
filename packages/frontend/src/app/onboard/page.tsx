'use client';

/**
 * /onboard — PRD-1 natural-language onboarding fast-path.
 *
 * One textarea + one submit. Calls POST /v3/concierge/onboard against the
 * configured backend. No wallet connection needed.
 */

import { useState } from 'react';

const API_BASE =
  process.env.NEXT_PUBLIC_AGENT_BACKEND_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001';

type OnboardLive = {
  status: 'live';
  agent_id: string;
  slug: string;
  agent_url: string;
  paywall_url: string;
  curl_example: string;
  message: string;
  verification_status: 'verified' | 'unverified';
  extraction_confidence: number;
  manifest: {
    name: string;
    description: string;
    endpoint_url: string;
    price_usdc: number;
    category: string;
  };
  next_steps: string[];
};

type OnboardClarify = {
  status: 'needs_clarification';
  message: string;
  missing_fields: string[];
};

type OnboardError = { error: string; message?: string };
type OnboardResult = OnboardLive | OnboardClarify | OnboardError;

const EXAMPLE_PROMPT =
  'My agent translates English to Vietnamese, priced at $0.05 per query, ' +
  'hosted at https://my-translator.example.com/api. Operator email: alice@example.com.';

export default function OnboardPage() {
  const [prompt, setPrompt] = useState('');
  const [operatorEmail, setOperatorEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OnboardResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit() {
    setLoading(true);
    setResult(null);
    setCopied(false);
    try {
      const res = await fetch(`${API_BASE}/v3/concierge/onboard`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt,
          operator_email: operatorEmail || undefined,
        }),
      });
      const body = (await res.json()) as OnboardResult;
      setResult(body);
    } catch (err) {
      setResult({ error: 'network_error', message: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  function copyCurl(text: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        },
        () => undefined,
      );
    }
  }

  const isLive = result && 'status' in result && result.status === 'live';
  const isClarify = result && 'status' in result && result.status === 'needs_clarification';
  const isError = result && 'error' in result;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-bold tracking-tight">Publish your AI agent on OpenX</h1>
      <p className="mt-3 text-gray-600">
        Describe your agent in one sentence — we&apos;ll put it live in about 10 seconds.
        You host the agent; OpenX handles the marketplace, paywall, and discovery.
      </p>

      <section className="mt-8 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Describe your agent</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={EXAMPLE_PROMPT}
            className="mt-1 block h-36 w-full rounded-md border border-gray-300 p-3 text-sm focus:border-gray-900 focus:outline-none"
            maxLength={2000}
          />
          <span className="mt-1 block text-xs text-gray-500">{prompt.length} / 2000</span>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-gray-700">Operator email (optional)</span>
          <input
            type="email"
            value={operatorEmail}
            onChange={(e) => setOperatorEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-1 block w-full rounded-md border border-gray-300 p-2 text-sm focus:border-gray-900 focus:outline-none"
          />
          <span className="mt-1 block text-xs text-gray-500">
            Used to notify you when earnings exceed $1 USDC. Skip if you prefer.
          </span>
        </label>

        <button
          onClick={submit}
          disabled={loading || prompt.trim().length < 30}
          className="rounded-md bg-black px-6 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Publishing... (~10s)' : 'Publish my agent'}
        </button>
      </section>

      {isLive && (
        <section className="mt-10 rounded-lg border-l-4 border-green-500 bg-green-50 p-6">
          <h2 className="text-lg font-bold text-green-900">✓ Your agent is live</h2>
          <p className="mt-2 text-sm text-green-900">{(result as OnboardLive).message}</p>

          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex items-baseline gap-3">
              <dt className="w-32 shrink-0 text-gray-600">Marketplace</dt>
              <dd>
                <a
                  href={(result as OnboardLive).agent_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-700 underline"
                >
                  {(result as OnboardLive).agent_url}
                </a>
              </dd>
            </div>
            <div className="flex items-baseline gap-3">
              <dt className="w-32 shrink-0 text-gray-600">Paywall URL</dt>
              <dd className="font-mono text-xs">{(result as OnboardLive).paywall_url}</dd>
            </div>
            <div className="flex items-baseline gap-3">
              <dt className="w-32 shrink-0 text-gray-600">Verification</dt>
              <dd>
                {(result as OnboardLive).verification_status === 'verified' ? (
                  <span className="rounded bg-green-200 px-2 py-0.5 text-xs font-medium text-green-900">
                    ✓ endpoint reachable
                  </span>
                ) : (
                  <span className="rounded bg-yellow-200 px-2 py-0.5 text-xs font-medium text-yellow-900">
                    ⚠ endpoint not yet reachable — implement POST /openx/health to verify
                  </span>
                )}
              </dd>
            </div>
            <div className="flex items-baseline gap-3">
              <dt className="w-32 shrink-0 text-gray-600">LLM confidence</dt>
              <dd>{((result as OnboardLive).extraction_confidence * 100).toFixed(0)}%</dd>
            </div>
          </dl>

          <div className="mt-6">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Try it from a terminal</span>
              <button
                onClick={() => copyCurl((result as OnboardLive).curl_example)}
                className="text-xs text-blue-700 underline"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="mt-2 overflow-x-auto rounded bg-white p-3 text-xs">
              {(result as OnboardLive).curl_example}
            </pre>
          </div>

          <ul className="mt-6 space-y-1 text-sm text-green-900">
            {(result as OnboardLive).next_steps.map((step, i) => (
              <li key={i}>→ {step}</li>
            ))}
          </ul>
        </section>
      )}

      {isClarify && (
        <section className="mt-10 rounded-lg border-l-4 border-yellow-500 bg-yellow-50 p-6">
          <h2 className="text-lg font-bold text-yellow-900">Need a bit more info</h2>
          <p className="mt-2 text-sm text-yellow-900">{(result as OnboardClarify).message}</p>
          {(result as OnboardClarify).missing_fields?.length > 0 && (
            <p className="mt-3 text-xs text-yellow-800">
              Missing: {(result as OnboardClarify).missing_fields.join(', ')}
            </p>
          )}
        </section>
      )}

      {isError && (
        <section className="mt-10 rounded-lg border-l-4 border-red-500 bg-red-50 p-6">
          <h2 className="text-lg font-bold text-red-900">Something went wrong</h2>
          <p className="mt-2 text-sm text-red-900">
            {(result as OnboardError).message ?? (result as OnboardError).error}
          </p>
        </section>
      )}

      <footer className="mt-12 border-t pt-6 text-xs text-gray-500">
        <p>
          OpenX is just the marketplace + paywall. Your endpoint runs the inference. Implement{' '}
          <code className="font-mono">POST /openx/health</code> on your service to get the
          verified-endpoint badge.
        </p>
      </footer>
    </main>
  );
}
