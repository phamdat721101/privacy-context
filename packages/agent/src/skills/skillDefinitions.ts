/**
 * Skill registry — dynamic-first with hardcoded fallback.
 *
 * Two skill sources coexist:
 *   1. Dynamic per-agent skills from `agent_skills` (Agent Training Pipeline v1).
 *      Loaded via an injected `DynamicSkillProvider` so this legacy runtime
 *      package stays Postgres-free.
 *   2. Hardcoded fallback (below) — kept as a safety net for agents that
 *      haven't acquired any dynamic skills yet.
 *
 * Precedence: dynamic hit → return AgentSkill. Otherwise, keyword match
 * against the hardcoded array. Never both.
 *
 * SOLID:
 *   - SRP: skill discovery only; execution lives in skillExecutor.ts.
 *   - DIP: DynamicSkillProvider is injected; no compile-time dependency on any
 *     particular DB stack.
 */

export interface SkillDefinition {
  publicSkillIndex: number;
  name: string;
  description: string;
  systemPrompt: string;
  triggerKeywords: string[];
}

/** Shape returned by the API's agentTrainingService.listAgentSkills(). */
export interface DynamicAgentSkill {
  slug: string;
  name: string;
  description: string;
  system_prompt: string;
  leading_word: string;
  trigger_patterns: string[];
}

export type ResolvedSkill =
  | { kind: 'hardcoded'; skill: SkillDefinition }
  | { kind: 'dynamic'; skill: DynamicAgentSkill };

export type DynamicSkillProvider = (
  agentId: string,
  message: string,
) => Promise<DynamicAgentSkill | null>;

export const SKILL_DEFINITIONS: SkillDefinition[] = [
  {
    publicSkillIndex: 1,
    name: 'DeFi Strategy Analyzer',
    description: 'Advanced DeFi yield farming and risk analysis',
    systemPrompt: `You are an expert DeFi strategist. Analyze yield opportunities, impermanent loss risks, protocol security, and optimal entry/exit strategies. Provide specific APY comparisons and risk scores.`,
    triggerKeywords: ['defi', 'yield', 'farming', 'liquidity', 'apy', 'impermanent loss', 'strategy'],
  },
  {
    publicSkillIndex: 2,
    name: 'Smart Contract Auditor',
    description: 'Security analysis and vulnerability detection for smart contracts',
    systemPrompt: `You are a senior smart contract security auditor. Identify vulnerabilities (reentrancy, overflow, access control, front-running), suggest fixes, and rate severity. Reference common CVE patterns.`,
    triggerKeywords: ['audit', 'vulnerability', 'security', 'reentrancy', 'exploit', 'contract audit', 'solidity bug'],
  },
  {
    publicSkillIndex: 3,
    name: 'Portfolio Optimizer',
    description: 'Encrypted portfolio allocation and rebalancing recommendations',
    systemPrompt: `You are a crypto portfolio optimization expert. Provide allocation recommendations, rebalancing strategies, risk-adjusted returns analysis, and correlation-based diversification advice.`,
    triggerKeywords: ['portfolio', 'allocation', 'rebalance', 'diversify', 'risk-adjusted', 'sharpe'],
  },
];

// Module-level provider slot. `null` when no dynamic source is wired up
// (backward-compat with any caller that still uses the 1-arg signature).
let dynamicProvider: DynamicSkillProvider | null = null;

/** Composition root wires the API-side dynamic-skill provider at boot. */
export function setDynamicSkillProvider(provider: DynamicSkillProvider | null): void {
  dynamicProvider = provider;
}

/**
 * Resolve the best-matching skill for a message.
 * - If `agentId` is provided AND a dynamic provider is wired AND a dynamic
 *   skill matches, return that.
 * - Otherwise, run the keyword match against the hardcoded fallback.
 * - Returns null when neither source matches.
 *
 * Backward compatibility: the legacy `detectSkill(message)` signature still
 * works because `agentId` is optional.
 */
export async function detectSkill(
  message: string,
  agentId?: string | null,
): Promise<ResolvedSkill | null> {
  if (agentId && dynamicProvider) {
    try {
      const dynamic = await dynamicProvider(agentId, message);
      if (dynamic) return { kind: 'dynamic', skill: dynamic };
    } catch {
      // Fail-open to hardcoded fallback; the hot path must never crash on
      // a provider outage.
    }
  }
  const lower = message.toLowerCase();
  for (const skill of SKILL_DEFINITIONS) {
    if (skill.triggerKeywords.some((kw) => lower.includes(kw))) {
      return { kind: 'hardcoded', skill };
    }
  }
  return null;
}

/**
 * Legacy synchronous helper for callers that still expect `SkillDefinition`.
 * Uses hardcoded fallback only. New callers should prefer `detectSkill(...)`.
 */
export function detectSkillSync(message: string): SkillDefinition | null {
  const lower = message.toLowerCase();
  for (const skill of SKILL_DEFINITIONS) {
    if (skill.triggerKeywords.some((kw) => lower.includes(kw))) return skill;
  }
  return null;
}
