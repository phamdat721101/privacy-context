/**
 * cognitive/namespaces.ts — single source of truth for the cognitive L1–L5
 * namespace convention (PRD-10).
 *
 * Pattern:  `cog-l{N}-{brainId}[-{sessionId}]`
 *
 *   L1 episodic     → cog-l1-<brainId>-<sessionId>   (sessionId REQUIRED)
 *   L2 semantic     → cog-l2-<brainId>
 *   L3 long-term    → cog-l3-<brainId>
 *   L4 workflow     → cog-l4-<brainId>
 *   L5 reflective   → cog-l5-<brainId>
 *
 * SOLID: this module is pure (no I/O), so it's safe to import everywhere
 * (frontend, api, worker, scripts).
 */

export type CognitiveLevel = 1 | 2 | 3 | 4 | 5;

export const COGNITIVE_LEVEL_LABELS: Record<CognitiveLevel, string> = {
  1: 'episodic',
  2: 'semantic',
  3: 'long-term',
  4: 'workflow',
  5: 'reflective',
};

/** Default per-query price defaults (USDC) per cognitive level — used by
 *  the publish wizard to pre-fill `price_per_query_usdc`. Sellers override. */
export const COGNITIVE_DEFAULT_PRICES_USDC: Record<CognitiveLevel, string> = {
  1: '0.005',
  2: '0.01',
  3: '0.05',
  4: '0.50',
  5: '5.00',
};

/**
 * Build the canonical namespace for a (level, brainId[, sessionId]) triple.
 * Throws when L1 is requested without a sessionId — `cog-l1-<brainId>` would
 * leak the per-session boundary that L1 episodic memory depends on.
 */
export function cogNamespace(
  level: CognitiveLevel,
  brainId: string,
  sessionId?: string,
): string {
  if (!brainId) throw new Error('cogNamespace: brainId required');
  if (level === 1) {
    if (!sessionId) throw new Error('cogNamespace: L1 episodic requires sessionId');
    return `cog-l1-${brainId}-${sessionId}`;
  }
  return `cog-l${level}-${brainId}`;
}

/**
 * Inverse — parses a namespace string back into the level/brainId/sessionId
 * triple. Returns `null` when the string doesn't match the schema, so callers
 * can treat malformed input as "not a cognitive namespace" rather than throw.
 */
export function parseCogNamespace(
  ns: string,
): { level: CognitiveLevel; brainId: string; sessionId?: string } | null {
  const m = /^cog-l([1-5])-(.+?)(?:-([^-]+))?$/.exec(ns);
  if (!m) return null;
  const level = Number(m[1]) as CognitiveLevel;
  const brainId = m[2];
  const sessionId = m[3];
  if (level === 1 && !sessionId) return null;
  return { level, brainId, sessionId };
}
