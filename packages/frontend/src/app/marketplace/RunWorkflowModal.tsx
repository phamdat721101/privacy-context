'use client';

import { useState } from 'react';

/**
 * RunWorkflowModal — workflow detail + run prep UI.
 *
 * Single-tier post-Sui-removal. The actual execution endpoint
 * (`/v3/marketplace/workflows/:slug/run`) lives in v3-marketplace.ts and
 * is auth-gated; payment flows through the standard x402 paywall the
 * buyer already has via Privy. This modal shows the steps + collects
 * input JSON, then POSTs to the run endpoint.
 *
 * SOLID:
 *   - SRP: render the workflow shape + dispatch the run request.
 *   - DI: parent passes the WorkflowSummary; component is reusable.
 */

import { AGENT_BACKEND_URL } from '@/lib/contracts';

export interface WorkflowSummary {
  id: string;
  slug?: string;
  workflow_key?: string;
  name: string;
  default_price_usdc?: string;
  steps?: Array<{ id: string; name: string }>;
}

export function RunWorkflowModal({
  workflow,
  walletAddress,
  onClose,
}: {
  workflow: WorkflowSummary;
  walletAddress?: string;
  onClose: () => void;
}) {
  const [inputJson, setInputJson] = useState<string>('{\n  "url": "https://example.com"\n}');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  const onRun = async () => {
    setError(null);
    setResult(null);
    if (!walletAddress) {
      setError('Sign in to run this workflow.');
      return;
    }
    let parsedInput: unknown;
    try {
      parsedInput = JSON.parse(inputJson);
    } catch {
      setError('Input must be valid JSON.');
      return;
    }

    setRunning(true);
    try {
      const slug = workflow.slug ?? workflow.workflow_key ?? workflow.id;
      const r = await fetch(
        `${AGENT_BACKEND_URL}/v3/marketplace/workflows/${encodeURIComponent(slug)}/run`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-wallet-address': walletAddress,
          },
          body: JSON.stringify({ input: parsedInput }),
        },
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${r.status}`);
      }
      setResult(await r.json());
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => !running && onClose()}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-4 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-headline text-lg font-semibold">{workflow.name}</h2>
            <p className="text-xs text-on-surface-variant">
              ${Number(workflow.default_price_usdc ?? '0').toFixed(2)} per run ·{' '}
              {(workflow.steps?.length ?? 0)} steps
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={running}
            className="text-on-surface-variant disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        <div className="space-y-1">
          <label className="text-xs uppercase text-on-surface-variant">Input (JSON)</label>
          <textarea
            value={inputJson}
            onChange={(e) => setInputJson(e.target.value)}
            disabled={running}
            rows={4}
            className="w-full rounded-lg border border-outline-variant/40 bg-surface px-3 py-2 font-mono text-xs text-on-surface focus:border-primary/60 focus:outline-none"
          />
        </div>

        <div className="flex-1 overflow-y-auto rounded-lg border border-outline-variant/30 bg-surface-container-low p-3">
          <div className="mb-2 text-xs uppercase text-on-surface-variant">Steps</div>
          <ol className="space-y-1.5">
            {(workflow.steps ?? []).map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded px-2 py-1 text-sm text-on-surface-variant"
              >
                <span className="font-mono text-xs">⚪ {s.name}</span>
              </li>
            ))}
          </ol>
        </div>

        {error && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-500">
            {error}
          </div>
        )}

        {result ? (
          <pre className="max-h-40 overflow-auto rounded-lg border border-primary/30 bg-primary/5 p-3 font-mono text-xs text-primary">
            {JSON.stringify(result, null, 2)}
          </pre>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={running}
            className="rounded-lg border border-outline-variant/40 px-3 py-1.5 text-sm text-on-surface-variant disabled:opacity-50"
          >
            Close
          </button>
          <button
            onClick={onRun}
            disabled={running}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-on-primary disabled:opacity-50"
          >
            {running ? 'Running…' : `Pay $${Number(workflow.default_price_usdc ?? '0').toFixed(2)} & Run`}
          </button>
        </div>
      </div>
    </div>
  );
}
