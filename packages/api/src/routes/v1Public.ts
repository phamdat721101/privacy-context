/**
 * /api/v1 — public, x402-paywalled brain endpoints.
 *
 * Per PRD-1:
 *   - GET /api/v1/<slug>                     → 402 → settle → 200 { answer, citations[] }
 *   - GET /api/v1/<slug>/.well-known/agent.json → AgentCard for n-payment auto-discovery
 *
 * Mounted WITHOUT parent auth: the paywall IS the auth.
 *
 * SOLID:
 *   - SRP: this module owns the public-API surface only. Inference, settlement,
 *     and ledger writes are delegated.
 *   - DIP: each agent's n-payment provider is built from agent config; we don't
 *     hard-code price/wallet/method anywhere.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { randomUUID, createHmac } from 'node:crypto';
import { pool } from '../db';
import { logger } from '../lib';
import { llmChat } from '../services/chat';
import { rankChunks } from '../services/rag';
import { KnowledgeIngestService } from '../services/knowledge-ingest';
import * as ledger from '../services/paidCallLedger';
import { verifyFherc20Receipt } from '../services/fherc20Verifier';

const router = express.Router();

// ─── canonical system-prompt merger ────────────────────────────────────────
//
/**
 * Artifact-emission protocol — appended to every system prompt so the LLM
 * knows it actually CAN deliver a file (the apparent "I can't make .docx"
 * refusals were the LLM hallucinating because it had never been told the
 * envelope exists). The downstream pipeline (extractAndUploadArtifacts +
 * renderArtifactFile) parses these blocks and materializes them as signed
 * download URLs — see lines 519+ of this file.
 *
 * Format is intentionally identical to the parser regex so a single edit
 * here propagates everywhere. Kept short to preserve token budget.
 */
const ARTIFACT_PROTOCOL = `
---
FILE DELIVERY PROTOCOL

You CAN produce downloadable files. The platform automatically packages
any \`<artifact>\` block in your response into a signed download URL the
user can click. Use it whenever the user asks for a deliverable file
(.md, .txt, .csv, .json, .docx, .pdf, .html, code files, etc.).

Format — emit the file alongside your prose:

<artifact>
<file path="result.docx">
# Heading
Body text in markdown. For .docx the server renders headings/paragraphs
to real Word styles automatically. Plain text/code passes through.
</file>
</artifact>

Rules:
- One <artifact> block can hold multiple <file> entries.
- Path is a relative filename (no leading slash, no "..").
- For binary content, add encoding="base64" on <file>.
- NEVER apologize that you "can't create files" or suggest manual
  copy-paste workarounds. The artifact block IS the file.
- Still write a short natural-language preamble outside the block so
  the user sees what they're getting.`;

// Both `/api/v1/<slug>` (this file) and `/v3/agents/:id/chat` (routes/v3.ts)
// build the LLM system prompt the same way: optional seller-authored prompt
// from `persona.system_prompt`, followed by the RAG-derived grounding block.
// Centralizing here removes a latent drift bug where v3 chat templated
// `${persona.system_prompt}\n\nUser:…` (rendering "undefined" when unset)
// while v1Public used RAG-only and ignored the seller prompt entirely.
//
// Pure: no I/O, no side effects.
export function buildSystemPrompt(
  persona: { system_prompt?: string | null } | null | undefined,
  ragContext: string,
): string {
  const sellerPrompt = (persona?.system_prompt ?? '').trim();
  const grounding = ragContext
    ? `Answer using ONLY this knowledge:\n${ragContext}`
    : `No knowledge available; respond honestly that the brain is empty.`;
  const base = sellerPrompt ? `${sellerPrompt}\n\n---\n\n${grounding}` : grounding;
  return `${base}\n${ARTIFACT_PROTOCOL}`;
}

/**
 * Dynamic-skill picker (Agent Training Pipeline v1.0).
 *
 * Returns the highest-audit-score active skill's system_prompt whose
 * `trigger_patterns` (case-insensitive substring) match the message. Returns
 * null when the feature flag is off, when the agent has no active skills,
 * or when no pattern matches — the paywall path then falls back to the
 * existing persona.system_prompt behavior.
 *
 * Kept as a top-level helper (not a service method) so it's a single ~15
 * line function that a code reviewer can audit in one glance. Uses the
 * shared `pool` — no extra service instantiation on the hot path.
 */
export async function pickDynamicSkillPrompt(
  agentId: string,
  message: string,
): Promise<string | null> {
  if (process.env.FEATURE_AGENT_TRAINING_PIPELINE !== 'true') return null;
  const r = await pool.query<{ system_prompt: string; trigger_patterns: string[] }>(
    `SELECT system_prompt, trigger_patterns
       FROM agent_skills
      WHERE agent_id = $1 AND status = 'active'
      ORDER BY audit_score DESC
      LIMIT 20`,
    [agentId],
  );
  if (r.rowCount === 0) return null;
  const lower = message.toLowerCase();
  for (const row of r.rows) {
    const patterns = Array.isArray(row.trigger_patterns) ? row.trigger_patterns : [];
    if (patterns.length === 0) continue;
    if (patterns.some((p) => typeof p === 'string' && p && lower.includes(p.toLowerCase()))) {
      return row.system_prompt;
    }
  }
  return null;
}

// ─── n-payment provider cache (one per slug, lazy) ─────────────────────────

interface AgentRow {
  id: string;
  slug: string;
  brain_id: number;
  owner_address: string;
  persona: { system_prompt?: string | null; description?: string } | null;
  pricing: { x402?: string | null; fherc20?: string | null };
  daily_request_cap: number;
  published: boolean;
  /** Chain stamped at create time. Used to render the correct chain id in
   *  agent.json so AI buyers know which network's USDC to settle in. */
  chain: string | null;
  /** PRD-G — seller revenue is accrued to this seller_id when a credit
   *  debit fires. Null for legacy v1 brains or platform demos. */
  seller_id: number | null;
}

interface CachedProvider {
  agent: AgentRow;
  middleware: express.RequestHandler;
  agentCardJson: object;
}

const providerCache = new Map<string, CachedProvider>();
const RESERVED_SLUGS = new Set(['api', 'admin', 'health', 'metrics', 'well-known', 'platform', 'credits']);

function isReserved(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

async function loadAgent(slug: string): Promise<AgentRow | null> {
  if (isReserved(slug)) return null;
  const r = await pool.query(
    `SELECT id, slug, brain_id, owner_address, persona, pricing, daily_request_cap, published, chain, seller_id
       FROM agents WHERE slug = $1 AND published = true AND archived_at IS NULL`,
    [slug],
  );
  return (r.rows[0] as AgentRow) ?? null;
}

/** Build the n-payment provider on demand. Called at most once per slug per process. */
async function buildProvider(agent: AgentRow): Promise<CachedProvider> {
  // n-payment 0.8.0 ships an ESM-only build: the `exports.require` entry
  // points to `./dist/index.cjs`, but that file is missing from the
  // published tarball — only `dist/index.js` (ESM) is shipped. A plain
  // `require('n-payment')` therefore fails with MODULE_NOT_FOUND, and
  // `await import('n-payment')` is silently rewritten by tsc (under
  // `module: commonjs`) into the same failing `require(...)` call.
  //
  // The fix below preserves a *native* dynamic import past tsc's rewriter
  // by hiding it inside a Function body. This is safe — and a deliberate
  // contrast to the previous `Function('m', 'return require(m)')` hack
  // that crashed at runtime: `require` is a CJS module-local binding so
  // it isn't visible inside a Function body (which executes in global
  // scope), but `import()` is engine-level JS syntax and resolves in any
  // scope. Same `: any` assertion sidesteps the viem 2.x → ox transitive
  // type graph that broke the build originally.
  const dynamicImport: (m: string) => Promise<any> = Function(
    'm',
    'return import(m)',
  ) as any;
  const np: any = await dynamicImport('n-payment');
  const { createAgentProvider, paidTool } = np;

  const priceUsdc = Number(agent.pricing?.x402 ?? '0');
  const priceMicroUsdc = Math.round(priceUsdc * 1_000_000);
  const facilitator =
    process.env.X402_FACILITATOR_URL ?? 'https://facilitator.x402.rs';
  // Chain priority: agent.chain (stamped at create time) → env override
  // → arbitrum-sepolia default. This way the same X402_NETWORK env can
  // serve as a global default while per-agent rows determine their own
  // settlement chain (Sui-published agents now report 'sui-testnet'
  // instead of incorrectly inheriting Arbitrum).
  const network = agent.chain ?? process.env.X402_NETWORK ?? 'arbitrum-sepolia';
  // Circle USDC on Arbitrum Sepolia (https://developers.circle.com/stablecoins/docs/usdc-on-test-networks)
  const asset =
    process.env.X402_USDC_ADDRESS ?? '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d';
  const publicApiUrl = process.env.PUBLIC_API_URL ?? 'http://localhost:3001';
  const endpointUrl = `${publicApiUrl}/api/v1/${agent.slug}`;

  const provider: any = createAgentProvider({
    name: agent.slug,
    description: `OpenX brain "${agent.slug}" — pay-per-call USDC on ${network}`,
    payTo: agent.owner_address,
    chain: network,
    asset,
    facilitator,
    tools: [
      paidTool({
        name: 'ask',
        description: 'Ask this brain a question.',
        price: priceMicroUsdc,
        handler: async (input: { question: string; uploadIds?: string[]; async?: boolean; webhook_url?: string; buyer_wallet?: string }) => {
          // PRD-2 M3 — async task branch. Buyer opts in via `async: true`.
          // Off when the master comm flag is false; the handler runs sync.
          if (input.async === true && process.env.FEATURE_BUYER_AGENT_COMM === 'true') {
            const task = await asyncTaskService.createTask({
              agent_id: agent.id,
              slug: agent.slug,
              buyer_wallet: (input.buyer_wallet ?? 'anonymous').toLowerCase(),
              payload: { question: input.question, uploadIds: input.uploadIds ?? [] },
              webhook_url: typeof input.webhook_url === 'string' ? input.webhook_url : undefined,
              estimated_seconds: 60,
            });
            return {
              status: 'accepted',
              task_id: task.id,
              poll_url: `${publicApiUrl}/api/v1/${agent.slug}/tasks/${task.id}`,
              estimated_seconds: 60,
            };
          }

          const result = await runInference(agent, input.question, input.uploadIds ?? []);

          // PRD-2 M2 — seller endpoint can opt into clarification by
          // returning `{status:'needs_clarification', question, options?}`.
          // Convert that into a clarification token + new thread so the
          // buyer can follow up via /api/v1/<slug>/clarify.
          const r = result as unknown as { status?: string; question?: string; options?: string[] };
          if (
            process.env.FEATURE_BUYER_AGENT_COMM === 'true' &&
            r &&
            r.status === 'needs_clarification' &&
            typeof r.question === 'string'
          ) {
            const buyer = (input.buyer_wallet ?? 'anonymous').toLowerCase();
            const thread = await threadService.createThread({
              buyer_wallet: buyer,
              agent_id: agent.id,
            });
            await threadService.addMessage({
              thread_id: thread.id,
              sender_type: 'agent',
              sender_id: agent.id,
              mode: 'm2',
              body: r.question,
            });
            const token = signClarificationToken({
              thread_id: thread.id,
              agent_id: agent.id,
              paid_call_id: null,
              original_question: input.question,
            });
            return {
              status: 'needs_clarification',
              clarification_token: token,
              agent_question: r.question,
              options: r.options ?? [],
              thread_id: thread.id,
              clarify_url: `${publicApiUrl}/api/v1/${agent.slug}/clarify`,
            };
          }
          return result;
        },
      }),
      // PRD-2 M4 — buyer-initiated message microbilled at the
      // communication_policy price (default $0.001 USDC).
      paidTool({
        name: 'message',
        description: 'Send a message to this agent in an existing thread.',
        price: Math.max(
          1,
          Math.round(
            Number(
              (agent as any).communication_policy?.buyer_message_price_usdc ?? 0.001,
            ) * 1_000_000,
          ),
        ),
        handler: async (input: { thread_id: string; body: string; buyer_wallet?: string }) => {
          if (process.env.FEATURE_BUYER_AGENT_COMM !== 'true') {
            return { status: 'feature_disabled' };
          }
          if (!input.thread_id || typeof input.body !== 'string' || !input.body.trim()) {
            return { status: 'error', error: 'thread_id + body required' };
          }
          const msg = await threadService.addMessage({
            thread_id: input.thread_id,
            sender_type: 'buyer',
            sender_id: (input.buyer_wallet ?? 'anonymous').toLowerCase(),
            mode: 'm4',
            body: input.body.slice(0, 4000),
          });
          return { status: 'sent', message_id: msg.id, thread_id: input.thread_id };
        },
      }),
    ],
  });

  // AgentCard JSON — built from the same config we passed to the provider.
  // This keeps the surface stable across n-payment minor versions.
  // `system_prompt` is exposed so AI buyers discover the seller's prompt
  // during the standard agent-card fetch (PRD-1 T3). Null when unset.
  const agentCardJson = {
    name: agent.slug,
    description: `OpenX brain "${agent.slug}" — pay-per-call USDC on ${network}`,
    url: endpointUrl,
    payTo: agent.owner_address,
    chain: network,
    asset,
    tools: [{ name: 'ask', price: priceMicroUsdc, currency: 'USDC' }],
    system_prompt: agent.persona?.system_prompt ?? null,
  };

  return { agent, middleware: provider.middleware(), agentCardJson };
}

/** Lookup-or-build with cached invalidation on owner update. */
async function getProvider(slug: string): Promise<CachedProvider | null> {
  if (providerCache.has(slug)) return providerCache.get(slug)!;
  const agent = await loadAgent(slug);
  if (!agent) return null;
  const built = await buildProvider(agent);
  providerCache.set(slug, built);
  return built;
}

/** Force-evict on agent edits (owner can call POST /v3/agents/:id and we should rebuild). */
export function invalidateProvider(slug: string): void {
  providerCache.delete(slug);
}

// ─── inference helper (kept small — delegates to existing services) ────────

/**
 * Inline budget for text-y attachments. Files smaller than this and with a
 * text-y MIME are fetched server-side via signed URL and pasted into the
 * prompt as labelled context. Anything larger is referenced by name + size
 * + signed URL so the LLM knows the document exists without us blowing
 * the context window.
 */
const UPLOAD_INLINE_BYTES = 100_000;
const TEXTY_MIME_RE = /^(text\/|application\/(json|csv|x-yaml|xml))/i;
const EXTRACTION_DOWNLOAD_CAP_BYTES = 50 * 1024 * 1024; // 50 MB safety cap on server-side download for parsing
const EXTRACTION_TEXT_BUDGET = 200_000; // chars of extracted text inlined per upload (~50k tokens)

interface UploadRow {
  id: string;
  storage_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
}

/**
 * Resolve `uploadIds[]` into an LLM-ready prompt prefix. Marks rows
 * consumed in the same transaction so a row can't be replayed across
 * many free /try calls.
 *
 * Pure-ish: queries DB + Supabase Storage; no other side-effects beyond
 * the consumed_at update. Returns the prompt prefix (possibly empty).
 */
export async function buildUploadContext(
  agentId: string,
  uploadIds: string[],
): Promise<string> {
  if (!uploadIds.length) return '';
  const { pool } = await import('../db');
  const r = await pool.query<UploadRow>(
    `UPDATE task_uploads
        SET consumed_at = NOW()
      WHERE id = ANY($1::uuid[])
        AND agent_id = $2
        AND consumed_at IS NULL
        AND expires_at > NOW()
      RETURNING id, storage_path, original_name, mime_type, size_bytes`,
    [uploadIds, agentId],
  );
  if (r.rowCount === 0) return '';

  const { getTaskUploadsStorage } = await import('../services/supabaseStorage');
  const storage = getTaskUploadsStorage();
  const blocks: string[] = [];
  for (const row of r.rows) {
    const uri = storage.toUri(row.storage_path);
    // 1. Always try server-side extraction first. Covers text-y MIMEs (UTF-8
    //    decode), .docx (mammoth), .pdf (pdf-parse). If anything succeeds,
    //    the LLM sees the actual content — no more "I cannot parse binary
    //    content" refusals. Files above the safety cap skip download.
    if (row.size_bytes <= EXTRACTION_DOWNLOAD_CAP_BYTES) {
      try {
        const buf = await storage.download(uri);
        const text = await tryExtractText(buf, row.mime_type, row.original_name);
        if (text) {
          const truncated = text.length > EXTRACTION_TEXT_BUDGET
            ? text.slice(0, EXTRACTION_TEXT_BUDGET) + '\n…[truncated]'
            : text;
          blocks.push(
            `Reference document "${row.original_name}" (${row.mime_type}, ${row.size_bytes} bytes):\n---\n${truncated}\n---`,
          );
          continue;
        }
      } catch (err) {
        logger.warn({ id: row.id, err: (err as Error).message }, 'upload:extract:failed');
      }
    }
    // 2. Fallback: emit a signed-URL reference plus an explicit "extraction
    //    failed" directive. Without this, the LLM sees an opaque signed URL
    //    and either hallucinates content or says "my brain is empty" — both
    //    bad UX. Telling the model exactly what to do here turns the failure
    //    into a clear, helpful response instead of a confused refusal.
    try {
      const signed = await storage.signedUrl(uri, 900);
      blocks.push(
        `Reference document "${row.original_name}" (${row.mime_type}, ${row.size_bytes} bytes): EXTRACTION_FAILED. ` +
          `The file could not be parsed as text (likely a scanned-image PDF, password-protected, or unsupported format). ` +
          `You CANNOT see the document content. Do not pretend you can. Do not say "my brain is empty". ` +
          `Tell the user kindly that the file couldn't be read and ask them to either ` +
          `(a) paste the source text directly into the chat, or ` +
          `(b) re-upload as a text-based file (PDF with selectable text, .docx, .txt, or .md). ` +
          `Once they provide the text, deliver the result as a .docx artifact per the FILE DELIVERY PROTOCOL above. ` +
          `Direct download URL (for buyer reference only): ${signed}`,
      );
    } catch (err) {
      logger.warn({ id: row.id, err: (err as Error).message }, 'upload:signed:failed');
      blocks.push(
        `Reference document "${row.original_name}" (${row.mime_type}, ${row.size_bytes} bytes): EXTRACTION_FAILED — file could not be loaded. ` +
          `Tell the user the upload couldn't be read and ask them to paste the source text directly.`,
      );
    }
  }
  return blocks.join('\n\n');
}

// ─── server-side document text extraction (PRD-H) ───────────────────────────
//
// Pure: takes bytes, returns text. No I/O beyond the lazy `import()` of
// the format-specific library. Each branch is independently optional —
// missing a library only kills that one format, never the whole pipeline.
//
// Adding a new format = one if-branch + one npm dep. SOLID-clean.

// Cap for vision-OCR fallback (Bedrock/OpenAI request body limits ~25 MB).
// Scanned PDFs above this skip OCR and surface as EXTRACTION_FAILED.
const OCR_MAX_BYTES = Math.max(1, Number(process.env.OCR_PDF_MAX_BYTES ?? 20 * 1024 * 1024));
// Hard ceiling on a single OCR call. Vision-LLM responses for ~50 page scans
// run 60–90s; anything beyond 2 min is almost certainly a stuck connection
// and must abort so the buyer sees a clean failure instead of the spinner.
const OCR_TIMEOUT_MS = Math.max(5_000, Number(process.env.OCR_TIMEOUT_MS ?? 120_000));

/**
 * OCR fallback for scanned-image PDFs.
 *
 * Same provider cascade as `llmChat`: Bedrock Claude first (native PDF
 * document support — no rasterizer needed), OpenAI vision second. No
 * `tesseract.js`, no `pdfjs-dist`, no native binaries: "simple to deploy"
 * stays simple. Returns extracted text or null on total failure; the
 * caller routes null into the existing EXTRACTION_FAILED block.
 *
 * Timeouts: each provider is bounded by OCR_TIMEOUT_MS — a stuck Bedrock
 * call falls through to OpenAI; a stuck OpenAI returns null. The buyer
 * always sees a result within roughly 2× OCR_TIMEOUT_MS, never an infinite
 * spinner.
 *
 * SOLID:
 *   • SRP — one job: bytes → text via vision model.
 *   • OCP — extra providers slot in as further if-branches.
 */
async function ocrPdfViaVision(buf: Buffer, name: string): Promise<string | null> {
  if (buf.length > OCR_MAX_BYTES) {
    logger.warn({ name, bytes: buf.length, cap: OCR_MAX_BYTES }, 'extract:pdf:ocr:over-cap');
    return null;
  }
  const prompt =
    'Extract ALL text from this document verbatim, preserving paragraph and line breaks. ' +
    'Do not summarize. Do not add commentary or markdown fences. Output the raw text only. ' +
    'If pages are images, OCR them. If unreadable or empty, output exactly: EMPTY.';
  const base64 = buf.toString('base64');

  // Provider 1 — Bedrock Claude (native PDF document content block).
  const bedrockKey = process.env.BEDROCK_API_KEY;
  if (bedrockKey) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), OCR_TIMEOUT_MS);
    try {
      const region = process.env.BEDROCK_REGION ?? 'us-east-1';
      const model = process.env.BEDROCK_MODEL ?? 'us.anthropic.claude-opus-4-6-v1';
      const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${model}/invoke`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bedrockKey}` },
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 16384,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
                { type: 'text', text: prompt },
              ],
            },
          ],
        }),
        signal: ac.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as { content?: Array<{ text?: string }> };
        const text = (data.content?.[0]?.text ?? '').trim();
        if (text && text !== 'EMPTY' && text.length >= 50) return text;
      } else {
        logger.warn(
          { name, status: res.status, body: (await res.text()).slice(0, 200) },
          'extract:pdf:ocr:bedrock-failed',
        );
      }
    } catch (err) {
      const isTimeout = (err as Error)?.name === 'AbortError';
      logger.warn(
        { name, err: (err as Error).message, timeoutMs: isTimeout ? OCR_TIMEOUT_MS : undefined },
        isTimeout ? 'extract:pdf:ocr:bedrock-timeout' : 'extract:pdf:ocr:bedrock-threw',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  // Provider 2 — OpenAI vision (Chat Completions accepts PDFs as `file`
  // content on GPT-4o family). Same fallback semantics as llmChat().
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey: openaiKey, timeout: OCR_TIMEOUT_MS, maxRetries: 0 });
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_VISION_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-4o',
        max_tokens: 16384,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'file', file: { filename: name, file_data: `data:application/pdf;base64,${base64}` } },
            ] as any,
          } as any,
        ],
      });
      const text = (completion.choices[0]?.message?.content ?? '').toString().trim();
      if (text && text !== 'EMPTY' && text.length >= 50) return text;
    } catch (err) {
      logger.warn({ name, err: (err as Error).message }, 'extract:pdf:ocr:openai-threw');
    }
  }
  return null;
}

async function tryExtractText(buf: Buffer, mime: string, name: string): Promise<string | null> {
  const lower = name.toLowerCase();
  // .docx (Office Open XML zip — mammoth handles parsing + style stripping)
  if (
    mime.includes('wordprocessingml') ||
    mime === 'application/msword' ||
    lower.endsWith('.docx') ||
    lower.endsWith('.doc')
  ) {
    try {
      const mammoth = await import('mammoth');
      const r = await mammoth.extractRawText({ buffer: buf });
      return r.value || null;
    } catch (e) {
      logger.warn({ err: (e as Error).message, name }, 'extract:docx:failed');
      return null;
    }
  }
  // .pdf
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) {
    try {
      const pdfParse = ((await import('pdf-parse')) as { default: (b: Buffer) => Promise<{ text: string }> }).default;
      const r = await pdfParse(buf);
      // Digital PDFs with embedded text — return immediately.
      const trimmed = (r.text ?? '').trim();
      if (trimmed.length >= 50) return r.text;
      // Sparse/empty text → almost certainly a scanned-image PDF.
      // Delegate to the existing vision-LLM (Claude on Bedrock accepts PDFs
      // natively) instead of dragging in a tesseract + rasterizer stack.
      // Null on total failure routes to the EXTRACTION_FAILED fallback.
      return await ocrPdfViaVision(buf, name);
    } catch (e) {
      logger.warn({ err: (e as Error).message, name }, 'extract:pdf:failed');
      // pdf-parse itself blew up (malformed, encrypted, …). Still try OCR
      // before giving up — vision models tolerate many things pdf-parse won't.
      return await ocrPdfViaVision(buf, name);
    }
  }
  // text-y MIMEs (text/*, json, csv, yaml, xml) — UTF-8 decode
  if (TEXTY_MIME_RE.test(mime) || /\.(txt|md|json|csv|ya?ml|xml|log)$/i.test(lower)) {
    try {
      return buf.toString('utf8');
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Run RAG + LLM for one paid call. Exported so PRD-2's `/v3/agents/:id/try`
 * can reuse the same path without duplicating the chunk-rank-LLM dance.
 *
 * `uploadIds` (PRD-E) attaches workspace files to the prompt. Empty array
 * is the legacy behaviour — every existing caller stays byte-identical.
 *
 * ─── ARTIFACT MODE (PRD-F) ────────────────────────────────────────────────
 * If the LLM emits `<artifact><file path="X">…</file>…</artifact>` blocks,
 * each file is uploaded to the `task-uploads` bucket and returned to the
 * caller as a signed download URL. This is how sellers ship multi-file
 * outputs (apps, scaffolds, code bundles) — the buyer downloads instead
 * of copy-pasting. Sellers opt in by instructing their persona to emit
 * the envelope; chat-only agents need no change (artifacts:[]).
 *
 * Forward-compat: when a true tool-loop ships later, this envelope stays
 * the final-emit format — zero rework for existing artifact-mode agents.
 */
export async function runInference(
  agent: { id?: string; brain_id: number; persona: AgentRow['persona'] },
  question: string,
  uploadIds: string[] = [],
): Promise<{
  answer: string;
  citations: number[];
  artifacts: ArtifactHandle[];
  inference_source: 'seller_endpoint' | 'openx_hosted_llm';
  seller_endpoint_error?: string;
  status?: 'pending';
  task_id?: string;
  poll_url?: string;
  message?: string;
  estimated_seconds?: number;
}> {
  // ── L2 self-hosted dispatcher ────────────────────────────────────────────
  // If the agent declares its own `endpoint_url`, OpenX is pure marketplace
  // + payment routing — the seller's box does inference. Three outcomes:
  //   ok:true     → seller answered synchronously; return as-is.
  //   ok:'pending'→ seller acknowledged, will deliver via /tasks/<id>/deliver.
  //                 We surface a pending envelope; buyer polls.
  //   ok:false    → seller call failed; capture reason + fall back to LLM.
  let seller_endpoint_error: string | undefined;
  if (agent.id) {
    const self = await dispatchToSelfHosted(agent.id, question, uploadIds);
    if (self) {
      if ('answer' in self) {
        return {
          answer: self.answer,
          citations: self.citations,
          artifacts: self.artifacts,
          inference_source: 'seller_endpoint',
        };
      }
      if ('external_task_id' in self) {
        const publicApiUrl = process.env.PUBLIC_API_URL ?? 'http://localhost:3001';
        // Resolve the slug so the poll URL matches what the buyer sees.
        const slugRow = await pool.query<{ slug: string | null }>(
          `SELECT slug FROM agents WHERE id = $1 LIMIT 1`,
          [agent.id],
        );
        const slug = slugRow.rows[0]?.slug ?? agent.id;
        return {
          // Empty placeholders satisfy the response contract; callers should
          // branch on `status === 'pending'` before reading `answer`.
          answer: '',
          citations: [],
          artifacts: [],
          inference_source: 'seller_endpoint',
          status: 'pending',
          task_id: self.external_task_id,
          poll_url: `${publicApiUrl}/api/v1/${slug}/tasks/${self.external_task_id}`,
          message: self.message,
          estimated_seconds: self.estimated_seconds,
        };
      }
      // Structural narrowing leaves the {ok:false, reason} branch.
      seller_endpoint_error = self.reason;
    }
  }

  const chunks = await KnowledgeIngestService.loadChunks(agent.brain_id);
  const ranked = rankChunks(question, chunks).slice(0, 5);
  const context = ranked.map((c) => c.content).filter(Boolean).join('\n---\n');
  // Dynamic-skill hook. Two paths:
  //   FEATURE_SKILL_AUTOLOADER=true  → PRD-U3 typed-trigger + budget-packed
  //                                    agentOrchestrationService.loadSkills
  //   FEATURE_SKILL_AUTOLOADER=false → Jul 3 substring pickDynamicSkillPrompt
  // Both return a single string prefix (or null) so the enrichedPersona
  // composition below is byte-identical across the flag switch.
  let dynamicPrompt: string | null = null;
  if (agent.id) {
    const { isOpenxV2SubFlagOn } = await import('../lib');
    if (isOpenxV2SubFlagOn('FEATURE_SKILL_AUTOLOADER')) {
      const { agentOrchestrationService } = await import('../services/agentOrchestrationService');
      const loaded = await agentOrchestrationService.loadSkills(agent.id, { messageText: question });
      dynamicPrompt = loaded.systemPromptPrefix || null;
    } else {
      dynamicPrompt = await pickDynamicSkillPrompt(agent.id, question);
    }
  }
  const enrichedPersona = dynamicPrompt
    ? {
        ...agent.persona,
        system_prompt: `${dynamicPrompt}\n\n${(agent.persona?.system_prompt ?? '').trim()}`.trim(),
      }
    : agent.persona;
  const system = buildSystemPrompt(enrichedPersona, context);
  const uploadCtx =
    agent.id && uploadIds.length
      ? await buildUploadContext(agent.id, uploadIds)
      : '';
  const userMsg = uploadCtx ? `${uploadCtx}\n\n${question}` : question;
  const raw = await llmChat(system, [{ role: 'user', content: userMsg }]);

  // Detect + harvest artifact envelopes. When absent, this is a no-op and
  // legacy chat agents return the byte-identical {answer, citations, []}.
  const { answer, artifacts } = agent.id
    ? await extractAndUploadArtifacts(agent.id, raw)
    : { answer: raw, artifacts: [] };

  return {
    answer,
    citations: ranked.map((_, i) => i),
    artifacts,
    inference_source: 'openx_hosted_llm',
    ...(seller_endpoint_error ? { seller_endpoint_error } : {}),
  };
}

// ─── L2 self-hosted dispatcher (PRD-G) ──────────────────────────────────────
//
// Contract sellers implement on `endpoint_url`:
//
//   POST <endpoint_url>
//     content-type: application/json
//     x-openx-agent-id: <uuid>
//   body: { agent_id, question, persona, upload_ids: [...] }
//   200 → { answer: string, citations?: number[], artifacts?: ArtifactHandle[] }
//
// SOLID: one function, one job — translate (agent_id + prompt) to the
// canonical response shape. Defense-in-depth: format CHECK at DB layer,
// SSRF guard here, hard timeout to keep the API worker free.

const SELLER_TIMEOUT_MS = Math.max(1000, Number(process.env.SELLER_ENDPOINT_TIMEOUT_MS ?? 60_000));

function isSafeSellerUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    // SSRF guard runs ALWAYS. Local development can opt out by setting
    // ALLOW_PRIVATE_ENDPOINTS=1 — never set this in production. Default-deny
    // protects the EC2 IMDS endpoint (169.254.169.254), cluster metadata
    // gateways, and operator's intranet.
    if (process.env.ALLOW_PRIVATE_ENDPOINTS === '1') return true;
    if (host === 'localhost' || host === '0.0.0.0' || host === '::1') return false;
    if (host.endsWith('.internal') || host.endsWith('.local')) return false;
    // RFC1918 + link-local + loopback IP literals (link-local 169.254.x covers IMDS).
    if (/^127\.|^10\.|^192\.168\.|^169\.254\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

type SelfHostedResult =
  | { ok: true; answer: string; citations: number[]; artifacts: ArtifactHandle[] }
  | { ok: false; reason: string }
  | { ok: 'pending'; external_task_id: string; message: string; estimated_seconds: number };

async function dispatchToSelfHosted(
  agentId: string,
  question: string,
  uploadIds: string[],
): Promise<SelfHostedResult | null> {
  const r = await pool.query<{ endpoint_url: string | null; persona: AgentRow['persona'] }>(
    `SELECT endpoint_url, persona FROM agents WHERE id = $1 AND endpoint_url IS NOT NULL LIMIT 1`,
    [agentId],
  );
  if (r.rowCount === 0) return null;
  const url = String(r.rows[0].endpoint_url);
  if (!isSafeSellerUrl(url)) {
    logger.warn({ agentId, url }, 'self-hosted:unsafe-url');
    return { ok: false, reason: `endpoint_url failed safety check: ${url}` };
  }
  const persona = r.rows[0].persona;

  // Pre-mint an external_task_id + HMAC token so the seller can call back
  // /deliver asynchronously if their pipeline needs more than SELLER_TIMEOUT_MS.
  // Sync sellers ignore both fields — additive contract, no breaking change.
  const externalTaskId = randomUUID().replace(/-/g, '').slice(0, 24);
  const taskToken = createHmac(
    'sha256',
    process.env.OPENX_WEBHOOK_SECRET ?? 'dev-only-webhook-secret-please-rotate',
  )
    .update(externalTaskId)
    .digest('hex')
    .slice(0, 32);
  const callbackUrl = `${process.env.PUBLIC_API_URL ?? 'http://localhost:3001'}/v3/agents/${agentId}/tasks/${externalTaskId}/deliver`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SELLER_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-openx-agent-id': agentId },
      body: JSON.stringify({
        agent_id: agentId,
        task_id: externalTaskId,
        task_token: taskToken,
        callback_url: callbackUrl,
        question,
        persona,
        upload_ids: uploadIds,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const reason = `seller endpoint ${res.status}: ${text.slice(0, 200).replace(/\s+/g, ' ').trim()}`;
      logger.warn({ agentId, url, status: res.status }, 'self-hosted:non-2xx-fallback');
      return { ok: false, reason };
    }
    const body = (await res.json().catch(() => ({}))) as {
      status?: unknown;
      answer?: unknown;
      message?: unknown;
      estimated_seconds?: unknown;
      citations?: unknown;
      artifacts?: unknown;
    };
    // Async path — seller acknowledges, promises to /deliver later.
    if (body.status === 'pending') {
      const message = typeof body.message === 'string' && body.message.trim().length > 0
        ? body.message
        : 'Your request is being processed by the agent.';
      const estimated_seconds =
        typeof body.estimated_seconds === 'number' && body.estimated_seconds > 0
          ? Math.min(86_400, Math.floor(body.estimated_seconds))
          : 120;
      // Park the task. Buyer polls /api/v1/<slug>/tasks/<external_task_id>;
      // seller eventually POSTs the answer to <callback_url>/deliver.
      await pool.query(
        `INSERT INTO agent_tasks
           (agent_id, buyer_wallet, payload, status,
            estimated_completion_at, external_task_id, seller_task_token)
         VALUES ($1, $2, $3::jsonb, 'running',
                 NOW() + ($4 || ' seconds')::interval, $5, $6)
         ON CONFLICT (external_task_id) WHERE external_task_id IS NOT NULL DO NOTHING`,
        [
          agentId,
          'anonymous',
          JSON.stringify({ question, uploadIds }),
          String(estimated_seconds),
          externalTaskId,
          taskToken,
        ],
      );
      logger.info({ agentId, external_task_id: externalTaskId, estimated_seconds }, 'self-hosted:pending');
      return { ok: 'pending', external_task_id: externalTaskId, message, estimated_seconds };
    }
    // Sync path — seller delivered an answer directly.
    if (typeof body.answer !== 'string' || body.answer.trim().length === 0) {
      logger.warn({ agentId, url, status: res.status }, 'self-hosted:empty-answer-fallback');
      return {
        ok: false,
        reason: 'seller endpoint returned 200 but no `answer` string or `status:"pending"` in body',
      };
    }
    return {
      ok: true,
      answer: body.answer,
      citations: Array.isArray(body.citations) ? body.citations.filter((n) => Number.isInteger(n)) : [],
      artifacts: Array.isArray(body.artifacts) ? (body.artifacts as ArtifactHandle[]) : [],
    };
  } catch (err) {
    const isTimeout = (err as Error)?.name === 'AbortError';
    const reason = isTimeout
      ? `seller endpoint timed out after ${SELLER_TIMEOUT_MS}ms`
      : `seller endpoint network error: ${(err as Error).message ?? 'unknown'}`;
    logger.warn({ agentId, url, isTimeout }, 'self-hosted:throw-fallback');
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

// ─── artifact extraction (PRD-F) ────────────────────────────────────────────
//
// The on-wire envelope sellers instruct their persona to emit:
//
//   <artifact>
//     <file path="src/App.tsx">…contents…</file>
//     <file path="package.json">…</file>
//   </artifact>
//
// Liberal regex parser:
//   • multiple <artifact> blocks per response are merged
//   • <file> path is sanitized to forbid path traversal
//   • binary base64 payloads are accepted via <file path="…" encoding="base64">
//   • parsing failure is non-fatal — bad envelopes degrade to plain text answer
//
// Files land in the SAME bucket as user uploads (`task-uploads`) under
// `<agent>/<task-id>/artifacts/<path>` with a 24h-ish signed URL. We reuse
// the existing SupabaseStorage service — no new infra, no new bucket.

export interface ArtifactHandle {
  path: string;
  size_bytes: number;
  mime_type: string;
  signed_url: string;
  storage_path: string;
}

const ARTIFACT_BLOCK_RE = /<artifact>([\s\S]*?)<\/artifact>/gi;
const ARTIFACT_FILE_RE = /<file\s+path="([^"]+)"(?:\s+encoding="([^"]+)")?\s*>([\s\S]*?)<\/file>/gi;

function safeArtifactPath(raw: string): string | null {
  // Strip leading/trailing slashes, forbid traversal segments. Allow nested
  // dirs but keep total depth + filename name length sane.
  const trimmed = raw.replace(/^\/+|\/+$/g, '').trim();
  if (!trimmed) return null;
  if (trimmed.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) return null;
  if (trimmed.length > 200) return null;
  // Per-segment whitelist — letters/digits/._- and a single dot, common code chars.
  if (!/^[a-zA-Z0-9._\-/]+$/.test(trimmed)) return null;
  return trimmed;
}

function guessMime(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    html: 'text/html', css: 'text/css', js: 'application/javascript',
    ts: 'application/typescript', tsx: 'application/typescript', jsx: 'application/javascript',
    json: 'application/json', md: 'text/markdown', txt: 'text/plain', csv: 'text/csv',
    yml: 'application/x-yaml', yaml: 'application/x-yaml', xml: 'application/xml',
    py: 'text/x-python', rb: 'text/x-ruby', go: 'text/x-go', rs: 'text/x-rust',
    sh: 'text/x-shellscript', sql: 'application/sql',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml',
    pdf: 'application/pdf', zip: 'application/zip',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return map[ext] ?? 'application/octet-stream';
}

async function extractAndUploadArtifacts(
  agentId: string,
  raw: string,
): Promise<{ answer: string; artifacts: ArtifactHandle[] }> {
  // Fast path — no envelope, no work.
  if (!raw.includes('<artifact>')) return { answer: raw, artifacts: [] };

  const files: Array<{ path: string; body: Buffer; mime: string }> = [];
  let cleaned = raw;
  try {
    let block: RegExpExecArray | null;
    ARTIFACT_BLOCK_RE.lastIndex = 0;
    while ((block = ARTIFACT_BLOCK_RE.exec(raw)) !== null) {
      const inner = block[1];
      ARTIFACT_FILE_RE.lastIndex = 0;
      let fm: RegExpExecArray | null;
      while ((fm = ARTIFACT_FILE_RE.exec(inner)) !== null) {
        const safe = safeArtifactPath(fm[1]);
        if (!safe) continue;
        const enc = (fm[2] ?? '').toLowerCase();
        const text = fm[3].replace(/^\n+/, '').replace(/\n+$/, '');
        const body = enc === 'base64'
          ? Buffer.from(text, 'base64')
          : Buffer.from(text, 'utf8');
        files.push({ path: safe, body, mime: guessMime(safe) });
      }
    }
    // Replace artifact blocks in the answer with a compact reference line so
    // the prose around them stays readable but the raw envelope doesn't bloat
    // the chat transcript.
    cleaned = raw.replace(ARTIFACT_BLOCK_RE, () => {
      const summary = files.map((f) => `  • ${f.path} (${f.body.length} bytes)`).join('\n');
      return `\n[Generated ${files.length} file(s):\n${summary}\n]`;
    }).trim();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'artifact:parse-failed');
    return { answer: raw, artifacts: [] };
  }

  if (files.length === 0) return { answer: raw, artifacts: [] };

  // Render each file to its target binary form. Plain text/code passes
  // through unchanged; .docx (and future .pdf) get markdown→binary
  // conversion so users can download a real Word doc instead of "I cannot
  // generate .docx" prose. Failure to render falls back to the raw bytes.
  const rendered: Array<{ path: string; body: Buffer; mime: string }> = [];
  for (const f of files) {
    try {
      const r = await renderArtifactFile(f.path, f.body);
      rendered.push({ path: f.path, body: r.body, mime: r.mime });
    } catch (err) {
      logger.warn({ path: f.path, err: (err as Error).message }, 'artifact:render-failed');
      rendered.push(f);
    }
  }

  // Best-effort upload. Storage misconfiguration is logged but does not fail
  // the inference — buyer still gets the answer text. Each file becomes a
  // signed-URL handle the buyer can download client-side.
  try {
    const { getTaskUploadsStorage } = await import('../services/supabaseStorage');
    const storage = getTaskUploadsStorage();
    await storage.ensureBucket({ public: false, fileSizeLimit: undefined });
    const taskId = randomUUID();
    const handles: ArtifactHandle[] = [];
    for (const f of rendered) {
      const storagePath = `${agentId}/${taskId}/artifacts/${f.path}`;
      try {
        await storage.upload(f.body, storagePath, f.mime);
        const uri = storage.toUri(storagePath);
        const signed = await storage.signedUrl(uri, 24 * 3600);
        handles.push({
          path: f.path,
          size_bytes: f.body.length,
          mime_type: f.mime,
          signed_url: signed,
          storage_path: storagePath,
        });
      } catch (err) {
        logger.warn({ path: f.path, err: (err as Error).message }, 'artifact:upload-failed');
      }
    }
    return { answer: cleaned, artifacts: handles };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'artifact:storage-unavailable');
    return { answer: cleaned, artifacts: [] };
  }
}

// ─── artifact rendering (PRD-H) ─────────────────────────────────────────────
//
// Convert agent-emitted text into the target binary format implied by the
// file extension. The agent can also pre-encode as base64 — in that case
// we trust the raw bytes and skip rendering. Currently:
//
//   • .docx ← markdown/text via `docx` npm package
//   • everything else ← identity (text or base64 stored verbatim)
//
// Adding .pdf, .xlsx, etc. is one more if-branch each. SOLID-clean.

async function renderArtifactFile(
  path: string,
  body: Buffer,
): Promise<{ body: Buffer; mime: string }> {
  const lower = path.toLowerCase();
  const mime = guessMime(path);
  if (lower.endsWith('.docx')) {
    try {
      const text = body.toString('utf8');
      // Heuristic: a real .docx (zip) starts with the bytes "PK\003\004";
      // if the agent emitted a base64-decoded zip, leave it alone.
      if (body.length > 2 && body[0] === 0x50 && body[1] === 0x4b) {
        return { body, mime };
      }
      const docxBuf = await markdownToDocxBuffer(text);
      return { body: docxBuf, mime };
    } catch (err) {
      logger.warn({ path, err: (err as Error).message }, 'render:docx:failed');
      // Fall through to identity — better to ship the markdown than nothing.
    }
  }
  return { body, mime };
}

async function markdownToDocxBuffer(text: string): Promise<Buffer> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');
  // Minimal markdown handling — headings + paragraphs. Real-world legal
  // translations care about clause numbering (preserved as plain text by
  // the LLM persona); rich style is out of scope for v1.
  const lines = text.split(/\r?\n/);
  const children: InstanceType<typeof Paragraph>[] = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) {
      children.push(new Paragraph({ children: [new TextRun('')] }));
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      const level = Math.min(h[1].length, 6);
      const levelEnum =
        [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
         HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][level - 1];
      children.push(new Paragraph({ heading: levelEnum, children: [new TextRun({ text: h[2], bold: true })] }));
      continue;
    }
    children.push(new Paragraph({ children: [new TextRun(line)] }));
  }
  const doc = new Document({ sections: [{ properties: {}, children }] });
  return Packer.toBuffer(doc);
}

// ─── routes ────────────────────────────────────────────────────────────────

/** Agent card discovery — public, free, cacheable. Must precede the paywall. */
router.get('/:slug/.well-known/agent.json', async (req: Request, res: Response) => {
  const provider = await getProvider(req.params.slug);
  if (!provider) return res.status(404).json({ error: 'agent not found' });
  res.set('Cache-Control', 'public, max-age=60');
  res.json(provider.agentCardJson);
});

// ─── PRD-2 M2/M3 routes (MUST be registered BEFORE the catch-all paywall) ──
//
// /clarify  — buyer follows up on a paid call that returned a clarification.
// /tasks/:id — buyer polls an async task created via ?async=true.
// Both are post-payment surfaces — no x402 challenge here.

import { createHmac as _createHmac, timingSafeEqual as _timingSafeEqual } from 'node:crypto';
import { threadService } from '../services/threadService';
import { asyncTaskService } from '../services/asyncTaskService';

const CLARIFICATION_SECRET =
  process.env.OPENX_CLARIFICATION_SECRET ??
  process.env.PAYMENT_SECRET ??
  'dev-only-clarification-secret-please-rotate';
const CLARIFICATION_TTL_SEC = Math.max(60, Number(process.env.OPENX_CLARIFICATION_TTL_SEC ?? 900));

function signClarificationToken(payload: {
  thread_id: string;
  agent_id: string;
  paid_call_id?: string | null;
  original_question: string;
}): string {
  const body = {
    thread_id: payload.thread_id,
    agent_id: payload.agent_id,
    paid_call_id: payload.paid_call_id ?? null,
    original_question: payload.original_question,
    expires_at: Date.now() + CLARIFICATION_TTL_SEC * 1000,
  };
  const canonical = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = _createHmac('sha256', CLARIFICATION_SECRET).update(canonical).digest('base64url');
  return `${canonical}.${sig}`;
}

function verifyClarificationToken(token: string): null | {
  thread_id: string;
  agent_id: string;
  paid_call_id: string | null;
  original_question: string;
  expires_at: number;
} {
  try {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = _createHmac('sha256', CLARIFICATION_SECRET).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !_timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.expires_at !== 'number' || payload.expires_at < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** POST /api/v1/<slug>/clarify — finish a clarification-paused inference. */
router.post('/:slug/clarify', async (req: Request, res: Response) => {
  if (process.env.FEATURE_BUYER_AGENT_COMM !== 'true') {
    return res.status(404).json({ error: 'not_found' });
  }
  const { clarification_token, answer } = (req.body ?? {}) as {
    clarification_token?: string;
    answer?: string;
  };
  if (typeof clarification_token !== 'string' || typeof answer !== 'string' || !answer.trim()) {
    return res.status(400).json({ error: 'clarification_token + answer required' });
  }
  const claims = verifyClarificationToken(clarification_token);
  if (!claims) return res.status(401).json({ error: 'invalid_or_expired_token' });

  const provider = await getProvider(req.params.slug);
  if (!provider || provider.agent.id !== claims.agent_id) {
    return res.status(404).json({ error: 'agent_not_found' });
  }

  try {
    // Persist the buyer's answer in the thread.
    await threadService.addMessage({
      thread_id: claims.thread_id,
      sender_type: 'buyer',
      sender_id: 'buyer',
      mode: 'm2',
      body: answer.slice(0, 4000),
      payment_event_id: claims.paid_call_id ?? undefined,
    });

    // Re-run inference with the answer appended to the original question.
    const fused = `${claims.original_question}\n\nClarification from buyer: ${answer}`;
    const result = await runInference(provider.agent, fused);

    // Persist the agent's refined answer.
    await threadService.addMessage({
      thread_id: claims.thread_id,
      sender_type: 'agent',
      sender_id: provider.agent.id,
      mode: 'm2',
      body: typeof result.answer === 'string' ? result.answer.slice(0, 16_000) : '',
      payment_event_id: claims.paid_call_id ?? undefined,
    });
    res.json({ ...result, thread_id: claims.thread_id, status: 'clarified' });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'clarify:failed');
    res.status(500).json({ error: 'clarify_failed' });
  }
});

/** GET /api/v1/<slug>/tasks/:task_id — poll an async task. */
router.get('/:slug/tasks/:task_id', async (req: Request, res: Response) => {
  if (process.env.FEATURE_BUYER_AGENT_COMM !== 'true') {
    return res.status(404).json({ error: 'not_found' });
  }
  // Two flavours of task_id may hit this route:
  //   1. external_task_id — short opaque token issued by OpenX in the
  //      seller-async flow (see dispatchToSelfHosted). Non-numeric.
  //   2. BIGSERIAL id from the M3 buyer-initiated async branch. Numeric.
  // We try (1) first because it's the seller's contract surface and
  // therefore the more public path.
  const param = String(req.params.task_id ?? '');
  const ext = /^[a-zA-Z0-9]{8,64}$/.test(param)
    ? await pool.query(
        `SELECT t.id, t.agent_id, t.slug, t.status, t.result, t.error_message,
                t.tee_attestation_hash, t.paid_call_id, t.created_at, t.completed_at,
                t.estimated_completion_at
           FROM agent_tasks t
          WHERE t.external_task_id = $1
          LIMIT 1`,
        [param],
      )
    : { rows: [], rowCount: 0 } as { rows: any[]; rowCount: number };

  const t = (ext.rowCount ?? 0) > 0
    ? ext.rows[0]
    : await asyncTaskService.getTask(param);
  if (!t) return res.status(404).json({ error: 'task_not_found' });

  // When the row came from agent_tasks directly, t.slug may be unset
  // (seller-async path stores agent_id only). Resolve from agent_id.
  let slug = t.slug as string | null;
  if (!slug && t.agent_id) {
    const s = await pool.query<{ slug: string | null }>(`SELECT slug FROM agents WHERE id = $1 LIMIT 1`, [t.agent_id]);
    slug = s.rows[0]?.slug ?? null;
  }
  if (slug && slug !== req.params.slug) return res.status(404).json({ error: 'task_not_found' });

  res.json({
    task_id: param,
    status: t.status,
    result: t.status === 'complete' ? t.result : null,
    error: t.status === 'failed' ? t.error_message : null,
    tee_attestation_hash: t.tee_attestation_hash,
    paid_call_id: t.paid_call_id,
    created_at: t.created_at,
    completed_at: t.completed_at,
    estimated_completion_at: t.estimated_completion_at ?? null,
  });
});

/** Daily request cap — checked BEFORE the paywall (cheap 503 saves the buyer a tx). */
async function rateLimit(slug: string, cap: number): Promise<boolean> {
  const today = await ledger.countToday(slug);
  return today < cap;
}

/**
 * Dual-rail dispatch: route fherc20-tagged X-PAYMENT to our verifier; everything
 * else flows through n-payment's standard middleware (x402 / exact).
 */
router.use('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  const provider = await getProvider(req.params.slug);
  if (!provider) return res.status(404).json({ error: 'agent not found' });

  const allowed = await rateLimit(provider.agent.slug, provider.agent.daily_request_cap);
  if (!allowed) {
    return res.status(503).set('Retry-After', '3600').json({ error: 'daily_request_cap reached' });
  }

  // Freemium gate (T5/PRD-B): shared with paymentGate.ts. The buyer
  // identifies themselves via X-BUYER (not wallet auth — /api/v1 is public).
  if (process.env.FEATURE_FHE_PAY === 'true') {
    const buyer = (req.headers['x-buyer'] as string | undefined)?.toLowerCase();
    if (buyer) {
      const freeLeft = await ledger.checkFreePreview(buyer, provider.agent.id);
      if (freeLeft > 0) {
        await ledger.recordFree(buyer, provider.agent.id, provider.agent.slug);
        res.setHeader('X-Free-Preview-Remaining', String(freeLeft - 1));
        (req as any).receipt = { method: 'free', txHash: 'free-preview' };
        logger.info({ slug: provider.agent.slug, buyer, freeLeft: freeLeft - 1 }, 'v1Public:freemium-pass');
        return next();
      }
    }
  }

  // PRD-G — credit-first debit. Buyer identifies via X-BUYER (same convention
  // as the freemium gate). When balance is sufficient, we debit silently
  // and short-circuit the n-payment middleware. Insufficient balance falls
  // through to the x402 / fherc20 paywalls untouched.
  if (process.env.FEATURE_CREDIT_SYSTEM === 'true') {
    const buyer = (req.headers['x-buyer'] as string | undefined)?.toLowerCase();
    const price = provider.agent.pricing?.x402;
    if (buyer && price && Number(price) > 0) {
      try {
        const credits = await import('../services/creditService');
        const debit = await credits.tryDebit({
          wallet_address: buyer,
          amount_usdc: price,
          agent_id: provider.agent.id,
          seller_id: (provider.agent as any).seller_id ?? null,
        });
        if (debit.ok) {
          await ledger.record({
            agentId: provider.agent.id,
            slug: provider.agent.slug,
            buyer,
            amountUsdc: price,
            txHash: `credit-${debit.ledger_id}`,
            network: process.env.X402_NETWORK ?? 'arbitrum-sepolia',
            method: 'credit',
            sellerId: (provider.agent as any).seller_id ?? null,
          });
          res.setHeader('X-Credit-Balance', debit.new_balance);
          (req as any).receipt = { method: 'credit', txHash: `credit-${debit.ledger_id}` };
          logger.info({ slug: provider.agent.slug, buyer, new_balance: debit.new_balance }, 'v1Public:credit-pass');
          return next();
        }
      } catch (err) {
        logger.warn({ err: (err as Error).message }, 'v1Public:credit-debit:failed');
      }
    }
  }

  // Buyer claims fherc20 path → verify on-chain log + advance.
  const xPay = (req.headers['x-payment'] as string | undefined) ?? '';
  if (xPay.startsWith('fherc20')) {
    const verified = await verifyFherc20Receipt({
      header: xPay,
      agent: provider.agent,
    });
    if (verified.ok !== true) {
      const reason = (verified as { ok: false; reason: string }).reason;
      return res.status(402).json({ error: reason });
    }
    // Advance to the route handler with verified receipt context.
    (req as any).receipt = { method: 'fherc20', txHash: verified.txHash };
    return next();
  }

  // Default: x402 / exact via n-payment middleware.
  return provider.middleware(req, res, next);
});

/** The single `ask` endpoint. Reaches here only after either rail verifies. */
router.get('/:slug', async (req: Request, res: Response) => {
  const provider = await getProvider(req.params.slug);
  if (!provider) return res.status(404).json({ error: 'agent not found' });

  const question = (req.query.q as string | undefined) ?? '';
  if (!question) return res.status(400).json({ error: 'q (question) required' });

  const result = await runInference(provider.agent, question);

  // fherc20 path needs explicit ledger write (n-payment handler runs only on x402).
  const receipt = (req as any).receipt as { method: string; txHash: string } | undefined;
  if (receipt?.method === 'fherc20') {
    await ledger.record({
      agentId: provider.agent.id,
      slug: provider.agent.slug,
      buyer: ((req.headers['x-buyer'] as string | undefined) ?? 'anonymous').toLowerCase(),
      amountUsdc: provider.agent.pricing?.fherc20 ?? '0.01',
      txHash: receipt.txHash,
      network: process.env.X402_NETWORK ?? 'arbitrum-sepolia',
      method: 'fherc20',
    }).catch((e) => logger.warn({ err: (e as Error).message }, 'ledger:record:fherc20:failed'));
  }
  res.json({ ...result, settled: receipt ?? { method: 'exact' } });
});

export default router;
