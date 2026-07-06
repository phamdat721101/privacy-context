import { pool } from '../db';
import { rankChunks } from './rag';
import { KnowledgeIngestService } from './knowledge-ingest';

const BEDROCK_REGION = process.env.BEDROCK_REGION ?? 'us-east-1';
// Single source of truth for the Bedrock model across the API + agent.
// Default = cheapest Claude on Bedrock (Haiku 3, $0.25/$1.25 per M tokens).
// Override with `BEDROCK_MODEL` env var if you want Sonnet / Opus quality.
const BEDROCK_MODEL = process.env.BEDROCK_MODEL ?? 'anthropic.claude-3-haiku-20240307-v1:0';

// Hard ceiling on a single LLM call. Without this, a slow Bedrock response
// (scanned-PDF OCR, long prompt) hangs the request indefinitely — the buyer
// sees the spinner spin forever, Caddy keeps the socket open, and PM2 has
// no signal to act on. 90s covers ~99% of real Claude responses; anything
// longer should surface as an error to the buyer, not a silent hang.
const LLM_TIMEOUT_MS = Math.max(5_000, Number(process.env.LLM_TIMEOUT_MS ?? 90_000));

/**
 * Provider-cascading LLM call. Bedrock-first when `BEDROCK_API_KEY` is set;
 * on auth failure (401/403 = expired/revoked key) or network error we
 * fall through to OpenAI rather than crashing the whole inference path.
 *
 * SOLID:
 *   • SRP — owns provider selection + error normalization, nothing else.
 *   • OCP — additional providers slot in as new branches; current callers
 *           are untouched.
 *
 * Errors are surfaced with provider tags so ops can tell from one log line
 * whether Bedrock died, OpenAI died, or both. No silent fallback masking.
 *
 * Timeouts: both providers are bounded by LLM_TIMEOUT_MS. Hitting the
 * timeout on Bedrock falls through to OpenAI (same semantics as a 5xx);
 * hitting it on OpenAI throws — the caller decides how to recover.
 */
export async function llmChat(system: string, messages: Array<{ role: string; content: string }>): Promise<string> {
  const bedrockKey = process.env.BEDROCK_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  // Provider 1 — Bedrock Claude. Skipped only when no key set.
  if (bedrockKey) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS);
    try {
      const url = `https://bedrock-runtime.${BEDROCK_REGION}.amazonaws.com/model/${BEDROCK_MODEL}/invoke`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${bedrockKey}` },
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          // 16k tokens accommodates multi-file <artifact> outputs (app scaffolds,
          // code bundles). Chat-only responses still fit comfortably under 4k —
          // billing is per-output-token, so this is a ceiling, not a floor.
          max_tokens: 16384,
          system,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
        }),
        signal: ac.signal,
      });
      if (res.ok) {
        const data = await res.json();
        return data.content?.[0]?.text ?? '';
      }
      // 401/403 → key rotated or scope dropped. Try the next provider.
      // Other 4xx/5xx → also fall through; OpenAI may still be fine.
      const body = await res.text();
      if (!openaiKey) throw new Error(`bedrock ${res.status}: ${body.slice(0, 200)}`);
      // Otherwise log + fall through.
      // eslint-disable-next-line no-console
      console.warn(`[llmChat] bedrock ${res.status}, falling back to openai: ${body.slice(0, 120)}`);
    } catch (err) {
      // AbortError === timeout: treat identical to a 5xx — try OpenAI if present.
      const msg = (err as Error)?.message ?? String(err);
      const isTimeout = (err as Error)?.name === 'AbortError';
      if (!openaiKey) throw isTimeout ? new Error(`bedrock: timeout after ${LLM_TIMEOUT_MS}ms`) : err;
      // eslint-disable-next-line no-console
      console.warn(`[llmChat] bedrock ${isTimeout ? 'timed out' : 'threw'}, falling back to openai: ${msg}`);
    } finally {
      clearTimeout(timer);
    }
  }

  // Provider 2 — OpenAI. Last-resort; throws with clear `openai:` tag.
  if (!openaiKey) {
    throw new Error('llmChat: no provider configured (set BEDROCK_API_KEY or OPENAI_API_KEY)');
  }
  const OpenAI = (await import('openai')).default;
  // SDK-native timeout — same envelope as Bedrock above, no Promise.race needed.
  const openai = new OpenAI({ apiKey: openaiKey, timeout: LLM_TIMEOUT_MS, maxRetries: 0 });
  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      max_tokens: 16384,
      messages: [{ role: 'system', content: system }, ...messages as any],
    });
    return completion.choices[0].message.content ?? '';
  } catch (err) {
    throw new Error(`openai: ${(err as Error).message}`);
  }
}

export class ChatService {
  static async chat(userAddress: string, message: string, brainId: string | null, mode: string, chain: string) {
    if (mode === 'store') {
      const bid = brainId || await this.getOrCreateBrain(userAddress, chain);
      await pool.query(`INSERT INTO knowledge_chunks (brain_id, content) VALUES ($1, $2)`, [bid, message]);
      return { response: 'Knowledge stored successfully.', stored: true, sources: [] };
    }

    const targetBrain = brainId || await this.getDefaultBrain(userAddress);
    const history = await this.loadHistory(userAddress, targetBrain, 5);

    let context = '';
    if (targetBrain) {
      // Loads plaintext + transparently decrypts encrypted chunks using the
      // brain's stored key material (Phase 1.5 — Phase 2 moves into TEE).
      const chunks = await KnowledgeIngestService.loadChunks(targetBrain);
      const ranked = rankChunks(message, chunks);
      context = ranked.map(c => c.content).filter(Boolean).join('\n---\n');
    }

    const systemPrompt = context
      ? `You are a Second Brain assistant. Answer using ONLY the following knowledge:\n${context}`
      : `You are a Second Brain assistant. The brain has no knowledge yet. Suggest the user store some first.`;

    const completion = await llmChat(systemPrompt, [
      ...history.map((h: any) => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ]);

    const reply = completion;
    await pool.query(
      `INSERT INTO chat_history (user_address, brain_id, role, content) VALUES ($1,$2,'user',$3), ($1,$2,'assistant',$4)`,
      [userAddress, targetBrain, message, reply]
    );

    return { response: reply, stored: false, sources: [] };
  }

  static async loadHistory(userAddress: string, brainId: string | number | null, limit: number) {
    const { rows } = await pool.query(
      `SELECT role, content FROM chat_history WHERE user_address = $1 AND brain_id = $2 ORDER BY created_at DESC LIMIT $3`,
      [userAddress, brainId, limit]
    );
    return rows.reverse();
  }

  static async history(userAddress: string, brainId: string | undefined, limit: number) {
    if (brainId) {
      const { rows } = await pool.query(
        `SELECT role, content, created_at FROM chat_history WHERE user_address = $1 AND brain_id = $2 ORDER BY created_at DESC LIMIT $3`,
        [userAddress, brainId, limit]
      );
      return rows.reverse();
    }
    const { rows } = await pool.query(
      `SELECT role, content, created_at FROM chat_history WHERE user_address = $1 ORDER BY created_at DESC LIMIT $2`,
      [userAddress, limit]
    );
    return rows.reverse();
  }

  private static async getOrCreateBrain(userAddress: string, chain: string): Promise<number> {
    const { rows } = await pool.query(`SELECT id FROM brains WHERE owner_address = $1 LIMIT 1`, [userAddress]);
    if (rows[0]) return rows[0].id;
    const { rows: created } = await pool.query(
      `INSERT INTO brains (owner_address, title, chain) VALUES ($1, 'My Brain', $2) RETURNING id`,
      [userAddress, chain]
    );
    return created[0].id;
  }

  private static async getDefaultBrain(userAddress: string): Promise<number | null> {
    const { rows } = await pool.query(`SELECT id FROM brains WHERE owner_address = $1 LIMIT 1`, [userAddress]);
    return rows[0]?.id || null;
  }
}
