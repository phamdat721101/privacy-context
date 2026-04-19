import { Router, Request, Response } from 'express';
import { getBlockchainService } from '../services/blockchainService';

export interface LicenseEntry {
  skillIndex: number;
  licenseId: string;
  purchasedAt: number;
  expiresAt: number;
}

// In-memory license store: userAddress (lowercase) → licenses
export const licenseStore = new Map<string, LicenseEntry[]>();

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
  const { publicSkillIndex, inPaymentAmount, inAgentOwner, licenseDurationSeconds, userAddress } = req.body as {
    publicSkillIndex: number; inPaymentAmount: string; inAgentOwner: string;
    licenseDurationSeconds?: number; userAddress?: string;
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

    // Store license in memory if userAddress provided
    if (userAddress) {
      const key = userAddress.toLowerCase();
      const licenses = licenseStore.get(key) ?? [];
      licenses.push({
        skillIndex: publicSkillIndex,
        licenseId: receipt.hash ?? '',
        purchasedAt: Math.floor(Date.now() / 1000),
        expiresAt: licenseDurationSeconds ? Math.floor(Date.now() / 1000) + licenseDurationSeconds : 0,
      });
      licenseStore.set(key, licenses);
    }

    return res.json({ ok: true, txHash: receipt.hash });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'Failed to purchase skill' });
  }
});

// Get user's active licenses
skillRouter.get('/user/:address/licenses', (req: Request, res: Response) => {
  const address = req.params.address.toLowerCase();
  const licenses = licenseStore.get(address) ?? [];
  const now = Math.floor(Date.now() / 1000);
  const active = licenses.filter(l => l.expiresAt === 0 || l.expiresAt > now);
  return res.json({ licenses: active });
});

// Register a license (called by frontend after on-chain purchase)
skillRouter.post('/register-license', (req: Request, res: Response) => {
  const { userAddress, skillIndex, licenseId, expiresAt } = req.body as {
    userAddress: string; skillIndex: number; licenseId: string; expiresAt?: number;
  };
  if (!userAddress || !skillIndex) {
    return res.status(400).json({ error: 'userAddress and skillIndex are required' });
  }
  const key = userAddress.toLowerCase();
  const licenses = licenseStore.get(key) ?? [];
  licenses.push({
    skillIndex,
    licenseId: licenseId ?? '',
    purchasedAt: Math.floor(Date.now() / 1000),
    expiresAt: expiresAt ?? 0,
  });
  licenseStore.set(key, licenses);
  return res.json({ ok: true });
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
