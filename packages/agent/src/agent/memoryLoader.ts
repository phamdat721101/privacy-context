import { FheTypes } from '@cofhe/sdk';
import { getBlockchainService } from '../services/blockchainService';
import { getAgentCofheClient } from '../fhe/agentClient';

export interface DecryptedMemory {
  interactionCount: number;
  memoryTier: number;
  lastInteraction: bigint;
}

export async function loadUserMemory(userAddress: string, permit: unknown): Promise<DecryptedMemory> {
  const chain = getBlockchainService();
  const handles = await chain.getMemoryHandles(userAddress);
  const client = await getAgentCofheClient();
  const p = permit as any;

  const [countResult, tierResult, timeResult] = await Promise.all([
    client.decryptHandle(handles.interactionCount, FheTypes.Uint32).setPermit(p).decrypt(),
    client.decryptHandle(handles.memoryTier, FheTypes.Uint8).setPermit(p).decrypt(),
    client.decryptHandle(handles.lastInteraction, FheTypes.Uint64).setPermit(p).decrypt(),
  ]);

  for (const r of [countResult, tierResult, timeResult]) {
    if (!r.success) throw new Error(`Memory decrypt failed: ${(r as any).error.message}`);
  }

  return {
    interactionCount: Number(countResult.data as bigint),
    memoryTier:       Number(tierResult.data as bigint),
    lastInteraction:  BigInt(timeResult.data as bigint),
  };
}
