'use client';
import { useWriteContract, usePublicClient } from 'wagmi';
import { CONTEXT_MANAGER_ADDRESS, ContextManagerAbi } from '@/lib/contracts';
import type { EncryptedContextInputs } from '@fhe-ai-context/sdk';

export function useWriteContext() {
  const { writeContractAsync, isPending, error } = useWriteContract();
  const publicClient = usePublicClient();

  async function writeContext(inputs: EncryptedContextInputs): Promise<void> {
    const hash = await writeContractAsync({
      address: CONTEXT_MANAGER_ADDRESS,
      abi: ContextManagerAbi,
      functionName: 'writeContext',
      args: [
        inputs.inSessionKey,
        inputs.inUserId,
        inputs.inSentimentScore,
        inputs.inTrustLevel,
        inputs.inIsVerified,
        inputs.inAuthorizedAgent,
      ],
    });
    const receipt = await publicClient!.waitForTransactionReceipt({ hash });
    if (receipt.status === 'reverted') {
      throw new Error('writeContext transaction reverted — check contract inputs');
    }
  }

  return { writeContext, isPending, error };
}
