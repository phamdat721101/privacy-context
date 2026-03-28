import { FheTypes } from '@cofhe/sdk';
import type { ContextHandles, DecryptedContext } from '@fhe-ai-context/sdk';
import { getAgentCofheClient } from './agentClient';

export async function decryptContextWithPermit(
  handles: ContextHandles,
  permit: unknown,
): Promise<DecryptedContext> {
  if (handles.sessionKey === 0n && handles.sentimentScore === 0n && handles.trustLevel === 0n) {
    throw new Error('User context not found — please onboard first by calling writeContext()');
  }

  const client = await getAgentCofheClient();
  const p = permit as any;

  const results = await Promise.all([
    client.decryptHandle(handles.sessionKey,     FheTypes.Uint128).setPermit(p).decrypt(),
    client.decryptHandle(handles.sentimentScore, FheTypes.Uint8).setPermit(p).decrypt(),
    client.decryptHandle(handles.trustLevel,     FheTypes.Uint8).setPermit(p).decrypt(),
    client.decryptHandle(handles.isVerified,     FheTypes.Bool).setPermit(p).decrypt(),
    client.decryptHandle(handles.memoryTier,     FheTypes.Uint8).setPermit(p).decrypt(),
  ]);

  for (const res of results) {
    if (!res.success) throw new Error(`Decryption failed: ${res.error.message}`);
  }

  return {
    sessionKey:     BigInt(results[0].data as bigint),
    sentimentScore: Number(results[1].data as bigint),
    trustLevel:     Number(results[2].data as bigint),
    isVerified:     Boolean(results[3].data),
    memoryTier:     Number(results[4].data as bigint),
  };
}
