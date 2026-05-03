import { Encryptable, type EncryptedItemInput } from '@cofhe/sdk';
import { createPublicClient, http, type WalletClient } from 'viem';
import { arbitrumSepolia as viemArbSepolia, arbitrum as viemArbitrum } from 'viem/chains';
import type { SupportedChain } from '../client/chains';
import { getCofheClient } from '../client/cofheClient';

export interface EncryptedMemoryInputs {
  inMemoryHash: EncryptedItemInput;
  inLastInteraction: EncryptedItemInput;
}

export async function encryptMemory(
  memoryHash: bigint,
  lastInteraction: bigint,
  chain: SupportedChain,
  walletClient: WalletClient,
): Promise<EncryptedMemoryInputs> {
  const client = getCofheClient();

  const viemChain = chain.id === 421614 ? viemArbSepolia : viemArbitrum;
  const publicClient = createPublicClient({ chain: viemChain, transport: http(chain.rpcUrl) });
  await client.connect(publicClient as any, walletClient as any);

  const [inMemoryHash] = await client.encryptInputs([Encryptable.uint128(memoryHash)]).execute();
  const [inLastInteraction] = await client.encryptInputs([Encryptable.uint64(lastInteraction)]).execute();

  return { inMemoryHash, inLastInteraction };
}
