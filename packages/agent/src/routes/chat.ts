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
import { getBlockchainService } from '../services/blockchainService';
import { Encryptable } from '@cofhe/sdk';
import { encodeAbiParameters } from 'viem';
import { getAgentCofheClient } from '../fhe/agentClient';
import { hashMemory } from '@fhe-ai-context/sdk';

const CHAT_FEE = 5_000_000n; // 5 tokens per chat (6 decimals)

function toBytes(input: { ctHash: bigint; securityZone: number; utype: number; signature: string }): `0x${string}` {
  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint8' }, { type: 'uint8' }, { type: 'bytes' }],
    [input.ctHash, input.securityZone, input.utype, input.signature as `0x${string}`],
  );
}

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

    // --- Billing: charge fee ---
    const chain = getBlockchainService();
    const billingAddress = process.env.AGENT_BILLING_ADDRESS;
    let settlementId: string | null = null;

    if (billingAddress) {
      const client = await getAgentCofheClient();

      // Encrypt fee amount
      const feeResult = await client.encryptInputs([Encryptable.uint64(CHAT_FEE)]).encrypt();
      if (!feeResult.success) throw new Error('Fee encryption failed');
      const inFee = toBytes(feeResult.data[0]);

      // Charge fee (branchless — returns ebool)
      try {
        await chain.chargeBillingFee(userAddress, inFee);
      } catch {
        return res.status(402).json({
          error: 'Insufficient prepaid balance. Please top up your agent billing balance.',
          agentAddress: chain.getSignerAddress(),
          billingAddress,
        });
      }

      // Record settlement (fire-and-forget)
      const reasonHash = hashMemory(`chat:${message.slice(0, 50)}`);
      const amtResult = await client.encryptInputs([Encryptable.uint64(CHAT_FEE)]).encrypt();
      const reasonResult = await client.encryptInputs([Encryptable.uint128(reasonHash)]).encrypt();
      if (amtResult.success && reasonResult.success) {
        chain.recordSettlement(
          userAddress, chain.getSignerAddress(),
          toBytes(amtResult.data[0]), toBytes(reasonResult.data[0]),
        ).catch(console.error);
      }
    }

    // --- Process chat or skill ---
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

    return res.json({ response, settlementId });
  } catch (e: any) {
    const msg = e?.message ?? 'Internal server error';
    const status = msg.includes('not found') ? 400 : 500;
    return res.status(status).json({ error: msg });
  }
});
