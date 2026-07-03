import type { DecryptedContext } from '@fhe-ai-context/sdk';
import { buildSystemPrompt } from '../agent/promptBuilder';
import { chatCompletion } from '../llm/llmClient';
import type { DecryptedMemory } from '../agent/memoryLoader';
import type { ResolvedSkill } from './skillDefinitions';

/**
 * Execute either the hardcoded or dynamic variant of a skill. Both paths
 * share the same buildSystemPrompt + chatCompletion pipeline — only the
 * system prompt differs.
 */
export async function executeSkill(
  resolved: ResolvedSkill,
  userMessage: string,
  ctx: DecryptedContext,
  memory?: DecryptedMemory | null,
): Promise<string> {
  const systemPrompt =
    resolved.kind === 'dynamic' ? resolved.skill.system_prompt : resolved.skill.systemPrompt;
  const basePrompt = buildSystemPrompt(ctx, memory, systemPrompt);
  return chatCompletion(basePrompt, userMessage);
}
