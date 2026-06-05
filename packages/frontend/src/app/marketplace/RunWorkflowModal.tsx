'use client';

import { useEffect, useRef, useState } from 'react';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import { useTier } from '@/hooks/useTier';
import { TatumMemwalAttestation } from '@/components/TrustlessVisualization';

/**
 * RunWorkflowModal — runs a workflow against /v3/workflows/:id/execute via
 * SSE so the user sees per-step progress. Pre-flight tier guard (G2) blocks
 * Standard-tier wallets — the modal opens but shows a switch prompt before
 * payment.
 *
 * SOLID:
 *   - SRP: this component owns the run lifecycle (input → SSE → done).
 *     It does NOT own marketplace listing or paywall plumbing.
 *   - DI: parent passes in workflow metadata + onClose; component is reusable
 *     anywhere a workflow can be run from.
 */

export interface WorkflowSummary {
  id: string;
  workflow_key?: string;
  name: string;
  default_price_usdc?: string;
  steps?: Array<{ id: string; name: string }>;
}

interface StepReceipt {
  stepId: string;
  amountUsdc: string;
  attestationHash?: string;
  success: boolean;
  failureMode?: string;
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
  const { tier, setTier } = useTier();
  const [inputJson, setInputJson] = useState<string>('{\n  "url": "https://example.com"\n}');
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<StepReceipt[]>([]);
  const [done, setDone] = useState<{ success: boolean; totalUsdc: string; runId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const onRun = async () => {
    setError(null);
    setReceipts([]);
    setDone(null);
    if (tier !== 'trustless') {
      setError('Workflow execution requires Sui network. Click "Switch to Sui" below.');
      return;
    }
    if (!walletAddress) {
      setError('Connect a Sui wallet first.');
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
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const r = await fetch(`${AGENT_BACKEND_URL}/v3/workflows/${workflow.id}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'x-wallet-address': walletAddress,
          'x-chain': 'sui',
        },
        body: JSON.stringify({ input: parsedInput, chain: 'sui' }),
        signal: ctrl.signal,
      });
      if (!r.ok || !r.body) {
        throw new Error(`HTTP ${r.status}`);
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop() ?? '';
        for (const e of events) {
          const eventLine = e.split('\n').find((l) => l.startsWith('event: '));
          const dataLine = e.split('\n').find((l) => l.startsWith('data: '));
          if (!eventLine || !dataLine) continue;
          const evt = eventLine.slice(7).trim();
          const data = JSON.parse(dataLine.slice(6));
          if (evt === 'step') {
            setStep(data.stepId);
            setReceipts((prev) => [...prev, data as StepReceipt]);
          } else if (evt === 'done') {
            setDone(data);
          } else if (evt === 'error') {
            setError(`${data.code}: ${data.message ?? ''}`);
          }
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(String(e?.message ?? e));
    } finally {
      setRunning(false);
      abortRef.current = null;
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
              ${Number(workflow.default_price_usdc ?? '0').toFixed(2)} per execution ·{' '}
              {(workflow.steps?.length ?? 0)} steps · paid in Sui-USDC
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

        {tier !== 'trustless' && (
          <div className="rounded-lg border border-secondary/30 bg-secondary/10 p-3 text-sm">
            <p className="mb-2 text-on-surface">
              <strong>Sui-only:</strong> workflow execution lives on Sui. Switch network to run.
            </p>
            <button
              onClick={() => setTier('trustless')}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs text-on-primary"
            >
              Switch to Sui
            </button>
          </div>
        )}

        {/* Input editor */}
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

        {/* DAG step list — animates as SSE events arrive */}
        <div className="flex-1 overflow-y-auto rounded-lg border border-outline-variant/30 bg-surface-container-low p-3">
          <div className="mb-2 text-xs uppercase text-on-surface-variant">Steps</div>
          <ol className="space-y-1.5">
            {(workflow.steps ?? []).map((s) => {
              const rec = receipts.find((r) => r.stepId === s.id);
              const status = rec ? (rec.success ? 'ok' : 'fail') : step === s.id ? 'live' : 'pending';
              return (
                <li
                  key={s.id}
                  className={`flex items-center justify-between rounded px-2 py-1 text-sm ${
                    status === 'ok'
                      ? 'bg-primary/10 text-primary'
                      : status === 'fail'
                        ? 'bg-amber-500/10 text-amber-500'
                        : status === 'live'
                          ? 'bg-secondary/10 text-secondary'
                          : 'text-on-surface-variant'
                  }`}
                >
                  <span className="font-mono text-xs">
                    {status === 'ok' ? '✅' : status === 'fail' ? '❌' : status === 'live' ? '⏳' : '⚪'} {s.name}
                  </span>
                  {rec && (
                    <span className="font-mono text-[10px]">
                      ${Number(rec.amountUsdc).toFixed(2)}
                      {rec.attestationHash ? ' · att' : ''}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        {error && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-500">
            {error}
          </div>
        )}

        {done && (
          <div
            className={`rounded-lg border p-3 text-sm ${
              done.success
                ? 'border-primary/30 bg-primary/5 text-primary'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-500'
            }`}
          >
            {done.success ? '✅' : '⚠️'} run {done.runId.slice(0, 8)} · ${Number(done.totalUsdc).toFixed(2)} routed
          </div>
        )}

        {/* F3 — surfaces sovereignty-proof + Memwal-bridge availability post-run. */}
        {done && done.success ? (
          <TatumMemwalAttestation
            productType="workflow"
            productId={workflow.id}
            apiBaseUrl={AGENT_BACKEND_URL}
          />
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
            disabled={running || tier !== 'trustless'}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-on-primary disabled:opacity-50"
          >
            {running ? 'Running…' : `Pay $${Number(workflow.default_price_usdc ?? '0').toFixed(2)} & Run`}
          </button>
        </div>
      </div>
    </div>
  );
}
