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
import { randomUUID } from 'node:crypto';
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
}

interface CachedProvider {
  agent: AgentRow;
  middleware: express.RequestHandler;
  agentCardJson: object;
}

const providerCache = new Map<string, CachedProvider>();
const RESERVED_SLUGS = new Set(['api', 'admin', 'health', 'metrics', 'well-known', 'platform']);

function isReserved(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

async function loadAgent(slug: string): Promise<AgentRow | null> {
  if (isReserved(slug)) return null;
  const r = await pool.query(
    `SELECT id, slug, brain_id, owner_address, persona, pricing, daily_request_cap, published, chain
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
        handler: async (input: { question: string; uploadIds?: string[] }) =>
          runInference(agent, input.question, input.uploadIds ?? []),
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
): Promise<{ answer: string; citations: number[]; artifacts: ArtifactHandle[] }> {
  // ── L2 self-hosted dispatcher ────────────────────────────────────────────
  // If the agent declares its own `endpoint_url`, OpenX is pure marketplace
  // + payment routing — the seller's box does inference. Same response
  // contract on the wire ({answer, citations?, artifacts?}) so paywall,
  // ledger, recent-calls feed, and frontend rendering stay byte-identical.
  // No caller changes needed: this function reads endpoint_url from the DB
  // itself so existing call-sites pass through unchanged.
  if (agent.id) {
    const self = await dispatchToSelfHosted(agent.id, question, uploadIds);
    if (self) return self;
  }

  const chunks = await KnowledgeIngestService.loadChunks(agent.brain_id);
  const ranked = rankChunks(question, chunks).slice(0, 5);
  const context = ranked.map((c) => c.content).filter(Boolean).join('\n---\n');
  const system = buildSystemPrompt(agent.persona, context);
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

  // Citations are positional indices into the ranked chunk list; the agent.json
  // surface declares this so callers can map [n] → ranked[n].
  return { answer, citations: ranked.map((_, i) => i), artifacts };
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

async function dispatchToSelfHosted(
  agentId: string,
  question: string,
  uploadIds: string[],
): Promise<{ answer: string; citations: number[]; artifacts: ArtifactHandle[] } | null> {
  const r = await pool.query<{ endpoint_url: string | null; persona: AgentRow['persona'] }>(
    `SELECT endpoint_url, persona FROM agents WHERE id = $1 AND endpoint_url IS NOT NULL LIMIT 1`,
    [agentId],
  );
  if (r.rowCount === 0) return null;
  const url = String(r.rows[0].endpoint_url);
  if (!isSafeSellerUrl(url)) {
    logger.warn({ agentId, url }, 'self-hosted:unsafe-url');
    throw new Error(`agent endpoint_url failed safety check`);
  }
  const persona = r.rows[0].persona;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SELLER_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-openx-agent-id': agentId },
      body: JSON.stringify({ agent_id: agentId, question, persona, upload_ids: uploadIds }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`seller endpoint ${res.status}: ${text.slice(0, 200)}`);
    }
    const body = (await res.json()) as {
      answer?: unknown;
      citations?: unknown;
      artifacts?: unknown;
    };
    return {
      answer: typeof body.answer === 'string' ? body.answer : '',
      citations: Array.isArray(body.citations) ? body.citations.filter((n) => Number.isInteger(n)) : [],
      artifacts: Array.isArray(body.artifacts) ? (body.artifacts as ArtifactHandle[]) : [],
    };
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
