'use client';

/**
 * /agent/[id]/run — task workspace.
 *
 * Layout (matches openx_agent_task_workspace mock, OpenX tokens only):
 *   • left  8/12 → agent identity strip + Task Parameters card
 *                  (requirement textarea, 50 MB drag-drop file zone)
 *   • right 4/12 → Execution Estimate + single Run button
 *                  + AgentRecentCalls (TX history) stacked below
 *
 * Free preview tier (PRD-E J): every run goes through /v3/agents/:id/try,
 * which is rate-limited and records `paid_calls.method='demo'`. No wallet
 * signature, no USDC, no x-payment-tx. Re-enabling paid is a one-commit
 * revert when ready.
 *
 * SOLID:
 *   • SRP — one page, one purpose. No chat composer, no integrate hero,
 *     no payment branch.
 *   • DIP — fetcher (`getAgent`, `uploadFileToAgent`) injected via lib/agents.
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { usePrivyEvmAddress } from '@/hooks/useActiveWallet';
import { AGENT_BACKEND_URL } from '@/lib/contracts';
import {
  getAgent,
  uploadFileToAgent,
  type Agent,
} from '@/lib/agents';
import { AgentRecentCalls } from '@/components/AgentRecentCalls';

// Client-side upload policy: the API is the source of truth. We accept any
// file type and let the server enforce the size cap via the mint response's
// `max_bytes` (0 = unlimited). The inline branch below is purely a
// performance heuristic for text-y files — *not* a type filter.
const UPLOAD_ACCEPT = '*/*';

// Inline budget mirrors the API's UPLOAD_INLINE_BYTES (v1Public.ts).
// Files at or under this size with a text-y MIME are read in the browser
// and prepended to `q` directly — bypassing the /uploads round-trip entirely.
// Result: the free-demo path works without Supabase Storage being configured.
const INLINE_BYTES = 100_000;
const INLINE_MIME_RE = /^(text\/|application\/(json|csv|x-yaml|xml|yaml))/i;

type AttachedFile =
  | {
      kind: 'inline';
      name: string;
      size: number;
      type: string;
      content: string;
    }
  | {
      kind: 'upload';
      upload_id: string;
      name: string;
      size: number;
      type: string;
    };

interface ArtifactHandle {
  path: string;
  size_bytes: number;
  mime_type: string;
  signed_url: string;
  storage_path: string;
}

interface RunResult {
  answer: string;
  citations: number[];
  artifacts?: ArtifactHandle[];
  settled?: { method: string; txHash: string; demo: boolean; amount_usdc: string };
  inference_source?: 'seller_endpoint' | 'openx_hosted_llm';
  seller_endpoint_error?: string;
  // PRD seller-async callback — seller acknowledged + will deliver via /deliver.
  status?: 'pending';
  task_id?: string;
  poll_url?: string;
  message?: string;
  estimated_seconds?: number;
}

export default function AgentWorkspacePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const userAddress = usePrivyEvmAddress();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);

  // Prefilled from the homepage's direct-to-run link (?q=<task text>), e.g.
  // clicking a matched agent card after typing a task on `/`. Lazy-init
  // only — the textarea is a normal controlled input from here on, so
  // user edits are never clobbered by a later re-read of the URL, and the
  // task is never auto-submitted (the user must still click "Run task").
  const [requirement, setRequirement] = useState(() => searchParams?.get('q') ?? '');
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [uploading, setUploading] = useState(false);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!params?.id) return;
    setLoading(true);
    getAgent(params.id)
      .then(setAgent)
      .finally(() => setLoading(false));
  }, [params?.id]);

  const submitDisabled = useMemo(() => {
    if (loading || running || uploading) return true;
    if (!requirement.trim() && files.length === 0) return true;
    if (!agent?.v3AgentId) return true; // legacy v1 brain — must be wrapped first
    return false;
  }, [loading, running, uploading, requirement, files.length, agent?.v3AgentId]);

  // ── attachment pipeline ─────────────────────────────────────────────────
  // Branch:
  //   • text-y MIME ≤ INLINE_BYTES → read in browser, attach as 'inline'
  //   • binary OR larger           → mint signed Supabase upload, attach as 'upload'
  // The inline branch removes the /uploads dependency for the common case
  // (small text/json/csv/md), so the free-demo path keeps working even if
  // Supabase Storage hasn't been provisioned for this deploy.
  //
  // No client-side size or type filter — the API is the source of truth.
  // If the server rejects (413, 415, …), the thrown error bubbles to the
  // banner below with the real reason.
  async function handleFiles(picked: FileList | null) {
    if (!picked || picked.length === 0 || !agent?.v3AgentId) return;
    setError(null);
    setUploading(true);
    try {
      const accepted: AttachedFile[] = [];
      for (const f of Array.from(picked)) {
        if (f.size <= INLINE_BYTES && INLINE_MIME_RE.test(f.type || 'text/plain')) {
          const content = await f.text();
          accepted.push({
            kind: 'inline',
            name: f.name,
            size: f.size,
            type: f.type || 'text/plain',
            content,
          });
        } else {
          const upload_id = await uploadFileToAgent(
            agent.v3AgentId,
            f,
            userAddress ?? undefined,
          );
          accepted.push({
            kind: 'upload',
            upload_id,
            name: f.name,
            size: f.size,
            type: f.type || 'application/octet-stream',
          });
        }
      }
      setFiles((prev) => [...prev, ...accepted]);
    } catch (e: any) {
      setError(e?.message ?? 'attachment failed');
    } finally {
      setUploading(false);
    }
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── tiered run ───────────────────────────────────────────────────────────
  async function callTry(headers: Record<string, string>) {
    // Compose the prompt: inline file contents prepended as labelled
    // context, the user's task last. Upload-backed files travel as ids;
    // the server fetches them via signed URL.
    const inlineCtx = files
      .filter((f): f is Extract<AttachedFile, { kind: 'inline' }> => f.kind === 'inline')
      .map(
        (f) =>
          `Reference document "${f.name}" (${f.type}, ${f.size} bytes):\n---\n${f.content}\n---`,
      )
      .join('\n\n');
    const baseQ =
      requirement.trim() ||
      `Use the attached document to perform the task implied by the assistant's persona.`;
    const finalQ = inlineCtx ? `${inlineCtx}\n\n${baseQ}` : baseQ;
    const upload_ids = files
      .filter((f): f is Extract<AttachedFile, { kind: 'upload' }> => f.kind === 'upload')
      .map((f) => f.upload_id);

    const r = await fetch(`${AGENT_BACKEND_URL}/v3/agents/${agent!.v3AgentId}/try`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ q: finalQ, upload_ids }),
    });
    if (r.status === 429) {
      const j = (await r.json().catch(() => ({}))) as { retryAfterSec?: number; error?: string };
      throw new Error(`${j.error ?? 'rate limited'} (retry in ${j.retryAfterSec ?? '?'}s)`);
    }
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `HTTP ${r.status}`);
    }
    return (await r.json()) as RunResult;
  }

  async function runFree() {
    setError(null);
    setResult(null);
    setRunning(true);
    try {
      const out = await callTry({});
      setResult(out);
      // PRD seller-async callback — when the seller's endpoint defers with
      // {status:'pending'}, poll the issued poll_url until the seller has
      // POSTed back through /deliver. The buyer's UI shows the blue banner
      // (rendered below) for the entire interval; on resolution we swap in
      // the final answer transparently.
      if (out.status === 'pending' && out.poll_url) {
        await pollPending(out);
      }
    } catch (e: any) {
      setError(e?.message ?? 'run failed');
    } finally {
      setRunning(false);
    }
  }

  // Polls the seller-async task; stops on `complete` or `failed` or after
  // ~maxWaitMs. Backoff stays gentle (3 s → 6 s → 6 s …) so the buyer's
  // browser doesn't hammer the API on a multi-minute pipeline.
  async function pollPending(initial: RunResult): Promise<void> {
    if (!initial.poll_url) return;
    const start = Date.now();
    const maxWaitMs = Math.min(15 * 60 * 1000, ((initial.estimated_seconds ?? 120) + 60) * 1000);
    let delay = 3_000;
    while (Date.now() - start < maxWaitMs) {
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(6_000, delay + 1_000);
      try {
        const r = await fetch(initial.poll_url, { method: 'GET' });
        if (!r.ok) continue;
        const j = (await r.json()) as {
          status: 'running' | 'complete' | 'failed' | 'pending';
          result?: { answer?: string; citations?: number[]; artifacts?: ArtifactHandle[] } | null;
          error?: string | null;
        };
        if (j.status === 'complete' && j.result?.answer) {
          setResult((prev) => ({
            ...(prev ?? initial),
            status: undefined,
            answer: j.result!.answer ?? '',
            citations: j.result?.citations ?? [],
            artifacts: j.result?.artifacts ?? [],
          }));
          return;
        }
        if (j.status === 'failed') {
          setError(`Seller pipeline failed: ${j.error ?? 'unknown error'}`);
          setResult((prev) => prev ? { ...prev, status: undefined, answer: '' } : prev);
          return;
        }
      } catch {
        /* transient network errors keep the loop running */
      }
    }
    setError('Timed out waiting for seller to deliver. Try again or check with the seller.');
  }

  // ── render ───────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="py-20 text-center text-on-surface-variant">Loading workspace…</div>;
  }
  if (!agent) {
    return (
      <div className="py-20 text-center">
        <p className="text-on-surface-variant">Agent not found.</p>
        <button
          onClick={() => router.push('/marketplace')}
          className="mt-3 text-sm text-primary hover:underline"
        >
          ← Back to marketplace
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* header strip */}
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-outline-variant/30 pb-4">
        <div className="min-w-0 space-y-1">
          <Link
            href={`/agent/${agent.id}`}
            className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant hover:text-primary"
          >
            <span className="material-symbols-outlined text-[14px]">arrow_back</span>
            back to detail
          </Link>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-primary">
              // task execution
            </span>
          </div>
          <h1 className="truncate font-headline text-2xl font-bold">{agent.title}</h1>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] text-on-surface-variant">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-secondary" />
          system secure
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* LEFT — agent identity + task parameters */}
        <div className="space-y-4 lg:col-span-8">
          <section className="flex items-center gap-4 rounded-xl border border-outline-variant/30 bg-surface p-5">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-primary">
              <span className="material-symbols-outlined text-[28px]">smart_toy</span>
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                {agent.v3AgentId ? (
                  <span className="rounded-full border border-secondary/30 bg-secondary/10 px-2 py-0.5 font-mono text-[10px] uppercase text-secondary">
                    LIVE
                  </span>
                ) : (
                  <span className="rounded-full border border-tertiary/30 bg-tertiary/10 px-2 py-0.5 font-mono text-[10px] uppercase text-tertiary">
                    DRAFT
                  </span>
                )}
                <span className="font-mono text-[10px] text-on-surface-variant">
                  ID: {(agent.v3AgentId ?? String(agent.id)).slice(0, 8)}…
                </span>
              </div>
              <p className="line-clamp-2 text-sm text-on-surface-variant">{agent.description}</p>
            </div>
          </section>

          <section className="rounded-xl border border-outline-variant/30 bg-surface">
            <div className="flex items-center justify-between border-b border-outline-variant/30 px-5 py-3">
              <h2 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">
                <span className="material-symbols-outlined text-[14px]">tune</span>
                Task parameters
              </h2>
              <span className="font-mono text-[10px] text-on-surface-variant">
                Markdown supported
              </span>
            </div>
            <div className="space-y-5 p-5">
              <div className="space-y-2">
                <label
                  htmlFor="task-requirement"
                  className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant"
                >
                  Describe requirement
                  <span className="text-error">*</span>
                </label>
                <textarea
                  id="task-requirement"
                  value={requirement}
                  onChange={(e) => setRequirement(e.target.value)}
                  rows={6}
                  maxLength={2000}
                  placeholder="E.g. Translate this NDA to Vietnamese, preserving section numbering."
                  className="w-full resize-y rounded-lg border border-outline-variant/40 bg-surface-container-low px-4 py-3 font-mono text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:border-primary/60 focus:outline-none"
                />
                <div className="text-right font-mono text-[10px] text-on-surface-variant">
                  {requirement.length} / 2000
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
                    Context data
                  </label>
                  <span className="font-mono text-[10px] text-on-surface-variant">
                    any file type · no size limit
                  </span>
                </div>
                <label
                  htmlFor="task-files"
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed bg-surface-container-low px-6 py-10 text-center transition-colors ${
                    uploading
                      ? 'border-primary/60'
                      : 'border-outline-variant/50 hover:border-primary/40'
                  }`}
                >
                  <span className="material-symbols-outlined text-[32px] text-on-surface-variant">
                    cloud_upload
                  </span>
                  <p className="mt-2 text-sm text-on-surface">
                    {uploading
                      ? 'Uploading…'
                      : 'Drag & drop or click to attach context files'}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-on-surface-variant">
                    any file — text, pdf, image, archive, binary…
                  </p>
                  <input
                    id="task-files"
                    type="file"
                    accept={UPLOAD_ACCEPT}
                    multiple
                    disabled={uploading || !agent.v3AgentId}
                    onChange={(e) => {
                      void handleFiles(e.target.files);
                      e.target.value = '';
                    }}
                    className="hidden"
                  />
                </label>
                {!agent.v3AgentId && (
                  <p className="font-mono text-[10px] text-on-surface-variant">
                    Draft agents can&apos;t accept uploads —{' '}
                    <Link
                      href={`/seller/onboard?return=${encodeURIComponent(`/agent/${agent.id}/run`)}&brain_id=${encodeURIComponent(String(agent.id))}`}
                      className="text-primary underline hover:opacity-80"
                    >
                      publish from Studio first
                    </Link>
                    .
                  </p>
                )}
                {files.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {files.map((f, i) => (
                      <li
                        key={`${i}-${f.name}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 font-mono text-[11px]"
                      >
                        <span className="truncate text-on-surface">{f.name}</span>
                        <span
                          className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase ${
                            f.kind === 'inline'
                              ? 'border-secondary/30 bg-secondary/10 text-secondary'
                              : 'border-tertiary/30 bg-tertiary/10 text-tertiary'
                          }`}
                          title={
                            f.kind === 'inline'
                              ? 'Embedded inline in the prompt'
                              : 'Uploaded · referenced via signed URL'
                          }
                        >
                          {f.kind}
                        </span>
                        <span className="shrink-0 text-on-surface-variant">
                          {(f.size / 1024).toFixed(1)} KB
                        </span>
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          aria-label={`remove ${f.name}`}
                          className="shrink-0 text-on-surface-variant hover:text-error"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>

          {(error || result) && (
            <section className="rounded-xl border border-outline-variant/30 bg-surface p-5">
              {error && (
                <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
                  {error}
                </div>
              )}
              {result && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-secondary/30 bg-secondary/10 px-2 py-0.5 font-mono text-[9px] uppercase text-secondary">
                      free preview
                    </span>
                    {result.citations.length > 0 && (
                      <span className="font-mono text-[10px] text-on-surface-variant">
                        cited chunks: [{result.citations.join(', ')}]
                      </span>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => downloadAsMarkdown(result.answer, agent?.title)}
                        className="inline-flex items-center gap-1 rounded-full border border-outline-variant/40 bg-surface-container-low px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant hover:border-primary/40 hover:text-primary"
                      >
                        <span className="material-symbols-outlined text-[14px]">download</span>
                        download .md
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await copyToClipboard(result.answer);
                          setCopied(true);
                          window.setTimeout(() => setCopied(false), 1500);
                        }}
                        className="inline-flex items-center gap-1 rounded-full border border-outline-variant/40 bg-surface-container-low px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant hover:border-primary/40 hover:text-primary"
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {copied ? 'check' : 'content_copy'}
                        </span>
                        {copied ? 'copied' : 'copy'}
                      </button>
                    </div>
                  </div>
                  {result.status === 'pending' && (
                    <div className="rounded-lg border-l-4 border-blue-500 bg-blue-500/10 p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-blue-500" />
                        <p className="font-semibold text-blue-900 dark:text-blue-300">
                          Your task is being processed by the agent
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-on-surface-variant">
                        {result.message ?? 'The seller endpoint acknowledged your request and is working on the answer. This page is polling for the result — sit tight.'}
                      </p>
                      <p className="mt-2 text-[11px] text-on-surface-variant">
                        Estimated wait: ~{result.estimated_seconds ?? 120}s · Task ID:{' '}
                        <code className="font-mono">{result.task_id}</code>
                      </p>
                    </div>
                  )}
                  {result.inference_source === 'openx_hosted_llm' && result.seller_endpoint_error && (
                    <div className="rounded-lg border-l-4 border-orange-500 bg-orange-500/10 p-3 text-sm">
                      <p className="font-semibold text-orange-900 dark:text-orange-300">
                        ⚠ Your endpoint failed — OpenX&apos;s LLM answered as fallback
                      </p>
                      <p className="mt-1 text-xs text-on-surface-variant">
                        OpenX tried to forward this query to your{' '}
                        <code className="font-mono text-primary">endpoint_url</code>, but the
                        call failed:
                      </p>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-surface-container-low p-2 font-mono text-[11px] leading-relaxed text-orange-900 dark:text-orange-300">
                        {result.seller_endpoint_error}
                      </pre>
                      <p className="mt-2 text-[11px] text-on-surface-variant">
                        Check your endpoint is reachable + returns{' '}
                        <code className="font-mono">{`{ "answer": "…" }`}</code> on POST. See{' '}
                        <a href="/docs" className="text-primary hover:underline">
                          /docs Section F
                        </a>{' '}
                        for the full contract. Buyer was not stranded — OpenX&apos;s LLM
                        answered using your persona prompt as a safety net.
                      </p>
                    </div>
                  )}
                  {result.inference_source === 'openx_hosted_llm' && !result.seller_endpoint_error && (
                    <div className="rounded-lg border-l-4 border-yellow-500 bg-yellow-500/10 p-3 text-sm">
                      <p className="font-semibold text-yellow-900 dark:text-yellow-300">
                        ⚠ Answered by OpenX&apos;s hosted LLM — not your agent
                      </p>
                      <p className="mt-1 text-xs text-on-surface-variant">
                        This response was generated by OpenX&apos;s Bedrock model using your
                        agent&apos;s <code className="font-mono">persona.system_prompt</code> +
                        knowledge base — not by your own code. To have YOUR endpoint answer
                        buyer queries, set{' '}
                        <code className="font-mono text-primary">endpoint_url</code>:
                      </p>
                      <pre className="mt-2 overflow-x-auto rounded bg-surface-container-low p-2 text-[10px] leading-relaxed">
{`curl -X PATCH ${AGENT_BACKEND_URL}/v3/agents/${params.id} \\
  -H 'content-type: application/json' \\
  -H 'x-wallet-address: <YOUR_WALLET>' \\
  -d '{"endpoint_url":"https://your.example.com/api"}'`}
                      </pre>
                      <p className="mt-1 text-[11px] text-on-surface-variant">
                        See{' '}
                        <a href="/docs" className="text-primary hover:underline">
                          /docs Section F
                        </a>{' '}
                        for the seller-endpoint contract (request/response shapes + health
                        probe + event webhooks).
                      </p>
                    </div>
                  )}
                  {result.inference_source === 'seller_endpoint' && (
                    <div className="rounded-lg border-l-4 border-green-500 bg-green-500/10 px-3 py-1.5 text-xs text-green-900 dark:text-green-300">
                      ✓ Answered by your endpoint — OpenX is acting as marketplace + paywall only.
                    </div>
                  )}
                  <pre className="overflow-x-auto whitespace-pre-wrap font-sans text-sm text-on-surface">
                    {result.answer}
                  </pre>
                  {result.artifacts && result.artifacts.length > 0 && (
                    <div className="mt-4 space-y-2 rounded-lg border border-secondary/30 bg-secondary/5 p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-secondary">
                          Generated files · {result.artifacts.length}
                        </span>
                        <span className="font-mono text-[10px] text-on-surface-variant">
                          signed url · 24h
                        </span>
                      </div>
                      <ul className="space-y-1.5">
                        {result.artifacts.map((a) => (
                          <li
                            key={a.storage_path}
                            className="flex items-center justify-between gap-2 rounded-md bg-surface px-3 py-2 font-mono text-[11px]"
                          >
                            <span className="truncate text-on-surface" title={a.path}>
                              {a.path}
                            </span>
                            <span className="shrink-0 text-on-surface-variant">
                              {(a.size_bytes / 1024).toFixed(1)} KB
                            </span>
                            <a
                              href={a.signed_url}
                              download={a.path.split('/').pop()}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 inline-flex items-center gap-1 rounded-full border border-primary/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-primary hover:bg-primary/10"
                            >
                              <span className="material-symbols-outlined text-[12px]">download</span>
                              get
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>

        {/* RIGHT — action box, then TX history (per spec, stacked, NO chat composer) */}
        <aside className="space-y-4 lg:col-span-4">
          <div className="sticky top-24 space-y-4">
            <section className="rounded-xl border border-primary/30 bg-surface p-5">
              <div className="absolute -mt-5 h-[2px] w-[calc(100%-2.5rem)] bg-primary/60" />
              <h3 className="flex items-center gap-2 border-b border-outline-variant/30 pb-2 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
                <span className="material-symbols-outlined text-[14px]">receipt_long</span>
                Execution estimate
              </h3>
              <dl className="mt-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <dt className="text-on-surface-variant">Compute cost</dt>
                  <dd className="font-mono text-secondary">FREE preview</dd>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <dt className="text-on-surface-variant">Path</dt>
                  <dd className="font-mono text-on-surface">demo · rate-limited</dd>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <dt className="text-on-surface-variant">Attachments</dt>
                  <dd className="font-mono text-on-surface">{files.length}</dd>
                </div>
              </dl>
              <button
                type="button"
                onClick={() => runFree()}
                disabled={submitDisabled}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 font-mono text-sm uppercase tracking-wider text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">
                  {running ? 'sync' : 'play_arrow'}
                </span>
                {running ? 'Running…' : 'Run task'}
              </button>
              <p className="mt-2 text-center font-mono text-[10px] text-on-surface-variant">
                No wallet needed · result downloadable.
              </p>
            </section>

            <AgentRecentCalls v3AgentId={agent.v3AgentId} limit={6} />
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─── result helpers (single consumer — this page) ──────────────────────────

/**
 * Trigger a browser download of the answer as a Markdown file.
 * Filename derived from the agent title + timestamp; falls back to "task".
 * No DOM library, no new component — just the standard Blob/anchor trick.
 */
function downloadAsMarkdown(answer: string, agentTitle: string | undefined): void {
  if (typeof window === 'undefined') return;
  const slug = (agentTitle ?? 'task')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'task';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const blob = new Blob([answer], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug}-${stamp}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Best-effort clipboard write. Resolves silently when blocked. */
async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* clipboard permission denied — silent */
  }
}
