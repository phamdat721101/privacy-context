import { FheTypes } from '@cofhe/sdk';
import type { SupportedChain } from '../client/chains';
import { getCofheClient } from '../client/cofheClient';

export interface MemoryHandles {
  memoryHash: bigint;
  lastInteraction: bigint;
  interactionCount: bigint;
  memoryTier: bigint;
}

export interface DecryptedMemory {
  memoryHash: bigint;
  lastInteraction: bigint;
  interactionCount: number;
  memoryTier: number;
}

export async function decryptMemory(
  handles: MemoryHandles,
  permit: unknown,
  chain: SupportedChain,
): Promise<DecryptedMemory> {
  const client = getCofheClient();
  const p = permit as any;

  const results = await Promise.all([
    client.decryptHandle(handles.memoryHash, FheTypes.Uint128).setPermit(p).decrypt(),
    client.decryptHandle(handles.lastInteraction, FheTypes.Uint64).setPermit(p).decrypt(),
    client.decryptHandle(handles.interactionCount, FheTypes.Uint32).setPermit(p).decrypt(),
    client.decryptHandle(handles.memoryTier, FheTypes.Uint8).setPermit(p).decrypt(),
  ]);

  for (const res of results) {
    if (!res.success) {
      throw new Error(`Decryption failed: ${res.error.message}`);
    }
  }

  return {
    memoryHash:       BigInt(results[0].data as bigint),
    lastInteraction:  BigInt(results[1].data as bigint),
    interactionCount: Number(results[2].data as bigint),
    memoryTier:       Number(results[3].data as bigint),
  };
}
