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
import { useParams, useRouter } from 'next/navigation';
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

const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const UPLOAD_ACCEPT =
  'text/*,application/json,application/pdf,application/wasm,image/png,image/jpeg,image/webp,.csv,.json,.md,.txt,.log,.pdf,.wasm';

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

interface RunResult {
  answer: string;
  citations: number[];
  settled?: { method: string; txHash: string; demo: boolean; amount_usdc: string };
}

export default function AgentWorkspacePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const userAddress = usePrivyEvmAddress();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);

  const [requirement, setRequirement] = useState('');
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
  async function handleFiles(picked: FileList | null) {
    if (!picked || picked.length === 0 || !agent?.v3AgentId) return;
    setError(null);
    setUploading(true);
    try {
      const accepted: AttachedFile[] = [];
      for (const f of Array.from(picked)) {
        if (f.size > UPLOAD_MAX_BYTES) {
          throw new Error(`${f.name} exceeds 50 MB`);
        }
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
            type: f.type,
          });
        }
        if (files.length + accepted.length >= 5) break; // cap matches /try server-side
      }
      setFiles((prev) => [...prev, ...accepted].slice(0, 5));
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
    } catch (e: any) {
      setError(e?.message ?? 'run failed');
    } finally {
      setRunning(false);
    }
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
                    up to 5 files · 50 MB each
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
                    text · pdf · csv · json · wasm · png/jpg
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
                  <pre className="overflow-x-auto whitespace-pre-wrap font-sans text-sm text-on-surface">
                    {result.answer}
                  </pre>
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
