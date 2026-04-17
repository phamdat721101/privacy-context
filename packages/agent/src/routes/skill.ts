import { Router, Request, Response } from 'express';
import { getBlockchainService } from '../services/blockchainService';

export const skillRouter = Router();

// List a new skill (encrypted inputs from client)
skillRouter.post('/list', async (req: Request, res: Response) => {
  const { inSkillId, inDeveloper, inBasePrice, inMaxSupply } = req.body as {
    inSkillId: string; inDeveloper: string; inBasePrice: string; inMaxSupply: string;
  };
  if (!inSkillId || !inDeveloper || !inBasePrice || !inMaxSupply) {
    return res.status(400).json({ error: 'All encrypted skill fields are required' });
  }
  try {
    const chain = getBlockchainService();
    const receipt = await chain.listSkill(
      inSkillId as `0x${string}`, inDeveloper as `0x${string}`,
      inBasePrice as `0x${string}`, inMaxSupply as `0x${string}`,
    );
    return res.json({ ok: true, txHash: receipt.hash });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'Failed to list skill' });
  }
});

// Purchase a skill license (encrypted inputs from client)
skillRouter.post('/purchase', async (req: Request, res: Response) => {
  const { publicSkillIndex, inPaymentAmount, inAgentOwner, licenseDurationSeconds } = req.body as {
    publicSkillIndex: number; inPaymentAmount: string; inAgentOwner: string; licenseDurationSeconds?: number;
  };
  if (!publicSkillIndex || !inPaymentAmount || !inAgentOwner) {
    return res.status(400).json({ error: 'publicSkillIndex, inPaymentAmount, inAgentOwner are required' });
  }
  try {
    const chain = getBlockchainService();
    const receipt = await chain.purchaseSkill(
      publicSkillIndex, inPaymentAmount as `0x${string}`,
      inAgentOwner as `0x${string}`, licenseDurationSeconds ?? 0,
    );
    return res.json({ ok: true, txHash: receipt.hash });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'Failed to purchase skill' });
  }
});

// Get skill handles for a given index
skillRouter.get('/:index/handles', async (req: Request, res: Response) => {
  const index = Number(req.params.index);
  if (isNaN(index) || index < 1) {
    return res.status(400).json({ error: 'Invalid skill index' });
  }
  try {
    const chain = getBlockchainService();
    const handles = await chain.getSkillHandles(index);
    const salesCount = await chain.getLicenseSaleCount(index);
    return res.json({ handles, salesCount });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'Failed to get skill handles' });
  }
});

// Get total skills listed
skillRouter.get('/count', async (_req: Request, res: Response) => {
  try {
    const chain = getBlockchainService();
    const count = await chain.getTotalSkillsListed();
    return res.json({ count });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'Failed to get count' });
  }
});
