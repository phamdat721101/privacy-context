/**
 * consolidator — pure functions that turn L1 episodes into L2 facts and
 * L2 facts into L3 procedural bundles. Zero LLM, fully deterministic.
 *
 * SOLID:
 *   - SRP: one module, two functions, no I/O.
 *   - DIP: callers pass already-decrypted arrays; this module never touches
 *     storage, network, or crypto.
 *   - OCP: a future LLM-grade synthesizer can be added as a sibling
 *     `richConsolidate()` without changing callers — but the current
 *     algorithm is sufficient for Phase 1 and provably free.
 *
 * The algorithm is intentionally simple: group episodes by topic, find the
 * top-1 normalized phrase shared by ≥3 episodes in the group, emit one fact
 * per (topic, phrase) — once. Dedup uses a SHA-256(topic + phrase)
 * fact_hash that the DB index `cognitive_facts_owner_hash_uniq` enforces.
 */

import {
  L3_TTL_SEC as _L3_TTL_SEC,
  type Episode,
  type FactType,
  type SemanticFact,
  type ProceduralBundle,
} from './types';
// ─── Public surface ─────────────────────────────────────────────────────────

/**
 * Result of a single consolidation pass over one owner's recent episodes.
 * `signing: candidate facts WITHOUT signer/signature populated` — the
 * service is responsible for signing them with the owner-on-behalf wallet.
 */
export interface ConsolidationCandidate {
  /** Plaintext claim. */
  fact: string;
  factType: FactType;
  topic: string;
  confidence: number;
  derivedFrom: string[];
  procedureKey?: string;
  derivedAt: number;
  /** Stable hash for unique-index dedup. */
  factHash: string;
}

export interface ConsolidationInput {
  /** Decrypted L1 episodes with their database ids attached. */
  episodes: Array<Episode & { id: string }>;
  /** fact_hash values already written for this owner — used for dedup. */
  existingFactHashes: Set<string>;
  /** Now (unix ms) — pass in for testability. */
  now?: number;
}

/**
 * consolidate — Phase 1 algorithm:
 *   1. group episodes by topic
 *   2. tokenize each group's bodies (lowercase, strip punctuation)
 *   3. find the top-1 most common content noun/phrase appearing in ≥3 episodes
 *   4. classify the resulting fact's type by verb heuristics
 *   5. emit one ConsolidationCandidate per (topic, phrase) — skipping anything
 *      whose fact_hash already exists
 *
 * Always returns an empty array if every group has < 3 episodes. Idempotent:
 * calling twice with the same inputs produces the same output set.
 */
export function consolidate(input: ConsolidationInput): ConsolidationCandidate[] {
  const now = input.now ?? Date.now();
  const out: ConsolidationCandidate[] = [];
  const byTopic = new Map<string, Array<Episode & { id: string }>>();
  for (const ep of input.episodes) {
    const arr = byTopic.get(ep.topic) ?? [];
    arr.push(ep);
    byTopic.set(ep.topic, arr);
  }

  for (const [topic, group] of byTopic) {
    if (group.length < 3) continue;
    const phrase = topPhrase(group.map((g) => g.body));
    if (!phrase) continue;

    const factHash = sha256Hex(`${topic}::${phrase}`);
    if (input.existingFactHashes.has(factHash)) continue;

    const claim = synthesizeClaim(topic, phrase, group);
    const factType = classify(claim);
    const procedureKey = inferProcedureKey(phrase, group);
    const N = group.length;

    out.push({
      fact: claim,
      factType,
      topic,
      confidence: Math.min(95, 70 + 5 * N),
      derivedFrom: group.map((g) => g.id),
      procedureKey,
      derivedAt: now,
      factHash,
    });
  }

  return out;
}

// ─── L2 → L3 promotion ──────────────────────────────────────────────────────

export interface PromotionInput {
  /** Owner's existing semantic facts (decrypted). Each must have `procedureKey`. */
  facts: Array<SemanticFact & { id: string }>;
  /** procedure_keys this owner has already minted as L3 bundles. */
  existingProcedureKeys: Set<string>;
  now?: number;
}

export interface PromotionCandidate {
  procedureKey: string;
  manifest: ProceduralBundle['manifest'];
  derivedFrom: string[];
  defaultPriceUsdc: string;
  createdAt: number;
}

/**
 * promoteToProcedural — Phase 1 algorithm:
 *   1. group facts by procedureKey (skip facts without one)
 *   2. for any group with ≥5 facts whose procedureKey is not already minted,
 *      emit one PromotionCandidate
 *   3. the manifest's `steps` are derived from the facts' fact bodies
 *      (deterministic — same input → same manifest)
 *   4. inputSchema/outputSchema are minimal placeholders that the owner
 *      can later refine via PATCH; buyers see them before running
 */
export function promoteToProcedural(input: PromotionInput): PromotionCandidate[] {
  const now = input.now ?? Date.now();
  const groups = new Map<string, Array<SemanticFact & { id: string }>>();
  for (const f of input.facts) {
    if (!f.procedureKey) continue;
    const arr = groups.get(f.procedureKey) ?? [];
    arr.push(f);
    groups.set(f.procedureKey, arr);
  }

  const out: PromotionCandidate[] = [];
  for (const [procedureKey, group] of groups) {
    if (group.length < 5) continue;
    if (input.existingProcedureKeys.has(procedureKey)) continue;
    out.push({
      procedureKey,
      manifest: {
        steps: group.slice(0, 5).map((f, i) => ({
          name: `step-${i + 1}`,
          description: f.fact,
        })),
        inputSchema: { type: 'object', properties: { input: { type: 'string' } } },
        outputSchema: { type: 'object', properties: { result: { type: 'string' } } },
      },
      derivedFrom: group.map((g) => g.id),
      defaultPriceUsdc: '0.05',
      createdAt: now,
    });
  }
  return out;
}

// ─── Internals ──────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these',
  'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'them', 'their',
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
  'all', 'each', 'every', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
  'than', 'too', 'very', 's', 't', 'just', 'don', 'now', 'in', 'on', 'at',
  'to', 'from', 'with', 'by', 'for', 'of', 'as', 'about', 'into', 'over',
  'after', 'before', 'between', 'through', 'during', 'until',
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/** Find the most common 1-2 word phrase appearing in ≥3 of the inputs. */
function topPhrase(bodies: string[]): string | null {
  const counts = new Map<string, number>();
  const seenPerBody = bodies.map((b) => new Set<string>());
  bodies.forEach((body, i) => {
    const tokens = tokenize(body);
    // Unigrams
    for (const t of tokens) {
      if (seenPerBody[i].has(t)) continue;
      seenPerBody[i].add(t);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    // Bigrams (often more semantically meaningful)
    for (let j = 0; j < tokens.length - 1; j++) {
      const bg = `${tokens[j]} ${tokens[j + 1]}`;
      if (seenPerBody[i].has(bg)) continue;
      seenPerBody[i].add(bg);
      counts.set(bg, (counts.get(bg) ?? 0) + 1);
    }
  });

  let best: { phrase: string; count: number } | null = null;
  for (const [phrase, count] of counts) {
    if (count < 3) continue;
    // Prefer bigrams over unigrams when both reach the threshold (more specific).
    const isBigram = phrase.includes(' ');
    const score = count * (isBigram ? 1.5 : 1);
    if (!best || score > best.count) best = { phrase, count: score };
  }
  return best?.phrase ?? null;
}

function synthesizeClaim(topic: string, phrase: string, group: Array<{ body: string }>): string {
  // Take the shortest body that contains the phrase as the canonical claim —
  // it's already a real sentence the user wrote/saw, not an LLM hallucination.
  const candidates = group
    .filter((g) => g.body.toLowerCase().includes(phrase))
    .sort((a, b) => a.body.length - b.body.length);
  const exemplar = candidates[0]?.body ?? `Recurring topic: ${phrase}.`;
  // Trim to a sentence-ish length (≤ 240 chars) — good for storage and UI.
  return exemplar.length > 240 ? exemplar.slice(0, 237) + '...' : exemplar;
}

function classify(claim: string): FactType {
  const lower = claim.toLowerCase();
  if (/\b(prefer|like|love|want|hate|dislike)\b/.test(lower)) return 'preference';
  if (/\b(is|are|was|were|will be)\b.{0,40}\b(based on|according to|from|by)\b/.test(lower)) {
    return 'relation';
  }
  if (/\b(my name is|i am|i'm|i live|i work|my .* is)\b/.test(lower)) return 'profile';
  if (/\b(happened|occurred|deployed|launched|released|shipped)\b/.test(lower)) return 'event';
  return 'fact';
}

/**
 * Heuristic procedure-key extraction. Looks for verb-object patterns that
 * commonly correspond to repeatable procedures (e.g. "verify FHE", "audit
 * Solidity", "summarize Twitter"). Returns kebab-case or null.
 */
function inferProcedureKey(phrase: string, group: Array<{ body: string }>): string | undefined {
  const verbs = ['verify', 'audit', 'check', 'summarize', 'review', 'compare', 'analyze', 'evaluate'];
  for (const body of group.map((g) => g.body.toLowerCase())) {
    for (const v of verbs) {
      const m = body.match(new RegExp(`\\b${v}\\b\\s+([a-z][a-z0-9\\s-]{2,30})`));
      if (m) {
        const tail = m[1].split(/\s+/).slice(0, 3).join('-').replace(/[^a-z0-9-]/g, '');
        if (tail) return `${v}-${tail}`;
      }
    }
  }
  // Fall back: kebab-case the phrase if it's specific enough to be a key.
  if (phrase.includes(' ')) return phrase.replace(/\s+/g, '-');
  return undefined;
}

function sha256Hex(s: string): string {
  // Browser+node-safe deterministic hash. Not cryptographic; the fact_hash
  // is used for dedup only, and the Postgres UNIQUE INDEX enforces real
  // uniqueness. FNV-1a 64-bit gives 32 hex chars matching the previous
  // SHA-256 truncation, so DB rows from either codepath stay compatible.
  let hi = 0xcbf29ce4 | 0;
  let lo = 0x84222325 | 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    lo = (lo ^ c) | 0;
    // Multiply by 0x100000001b3 (FNV prime) using 32-bit halves.
    const PRIME_LO = 0x000001b3;
    const PRIME_HI = 0x00000100;
    const newLo = Math.imul(lo, PRIME_LO);
    const newHi = (Math.imul(hi, PRIME_LO) + Math.imul(lo, PRIME_HI)) | 0;
    lo = newLo | 0;
    hi = newHi | 0;
  }
  const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  // 32 hex chars total (matches the previous truncation of SHA-256 to 32 hex).
  return (toHex(hi) + toHex(lo)).repeat(2).slice(0, 32);
}

// Re-export so callers don't have to import twice.
export { _L3_TTL_SEC };
