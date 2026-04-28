import { Router, Request, Response } from 'express';
import { loadUserContext } from '../agent/contextLoader';
import { loadUserMemory } from '../agent/memoryLoader';
import { buildSystemPrompt } from '../agent/promptBuilder';
import { handleResponse } from '../agent/responseHandler';
import { chatCompletion } from '../llm/llmClient';
import { importAgentPermit } from '../fhe/agentClient';
import { detectSkill } from '../skills/skillDefinitions';
import { executeSkill } from '../skills/skillExecutor';
import { hasActiveLicense } from '../services/licenseCache';
import { requireFields } from '../middleware/validate';

export const chatRouter = Router();

chatRouter.post('/', requireFields('userAddress', 'message', 'serializedPermit'), async (req: Request, res: Response) => {
  const { userAddress, message, serializedPermit } = req.body as {
    userAddress: string;
    message: string;
    serializedPermit: string;
  };

  try {
    const permit = await importAgentPermit(serializedPermit);
    const ctx = await loadUserContext(userAddress, permit);
    const memory = await loadUserMemory(userAddress, permit).catch(() => null);

    const skill = detectSkill(message);
    let response: string;

    if (skill) {
      if (!hasActiveLicense(userAddress, skill.publicSkillIndex)) {
        response = `🔒 This request requires the "${skill.name}" skill.\n\nPurchase a license from the Skill Marketplace to unlock:\n• ${skill.description}\n\nVisit /marketplace to browse available skills.`;
      } else {
        response = await executeSkill(skill, message, ctx, memory);
      }
    } else {
      const systemPrompt = buildSystemPrompt(ctx, memory);
      response = await chatCompletion(systemPrompt, message);
    }

    handleResponse(userAddress, message, response).catch(console.error);

    return res.json({ response });
  } catch (e: any) {
    const msg = e?.message ?? 'Internal server error';
    const status = msg.includes('not found') ? 400 : 500;
    return res.status(status).json({ error: msg });
  }
});
