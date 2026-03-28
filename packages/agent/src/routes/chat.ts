import { Router, Request, Response } from 'express';
import { loadUserContext } from '../agent/contextLoader';
import { loadUserMemory } from '../agent/memoryLoader';
import { buildSystemPrompt } from '../agent/promptBuilder';
import { handleResponse } from '../agent/responseHandler';
import { chatCompletion } from '../llm/llmClient';
import { importAgentPermit } from '../fhe/agentClient';

export const chatRouter = Router();

chatRouter.post('/', async (req: Request, res: Response) => {
  const { userAddress, message, serializedPermit } = req.body as {
    userAddress: string;
    message: string;
    serializedPermit: string;
  };

  if (!userAddress || !message || !serializedPermit) {
    return res.status(400).json({ error: 'userAddress, message, and serializedPermit are required' });
  }

  try {
    const permit = await importAgentPermit(serializedPermit);
    const ctx = await loadUserContext(userAddress, permit);
    const memory = await loadUserMemory(userAddress, permit).catch(() => null);
    const systemPrompt = buildSystemPrompt(ctx, memory);
    const response = await chatCompletion(systemPrompt, message);

    // Fire-and-forget: update memory after responding
    handleResponse(userAddress, message, response).catch(console.error);

    return res.json({ response });
  } catch (e: any) {
    const msg = e?.message ?? 'Internal server error';
    const status = msg.includes('not found') ? 400 : 500;
    return res.status(status).json({ error: msg });
  }
});
