import { Encryptable } from '@cofhe/sdk';
import { createPublicClient, http, encodeAbiParameters, type WalletClient } from 'viem';
import { arbitrumSepolia as viemArbSepolia, arbitrum as viemArbitrum } from 'viem/chains';
import type { SupportedChain } from '../client/chains';
import { getCofheClient } from '../client/cofheClient';

export interface EncryptedMemoryInputs {
  inMemoryHash: `0x${string}`;
  inLastInteraction: `0x${string}`;
}

function toBytes(input: { ctHash: bigint; securityZone: number; utype: number; signature: string }): `0x${string}` {
  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint8' }, { type: 'uint8' }, { type: 'bytes' }],
    [input.ctHash, input.securityZone, input.utype, input.signature as `0x${string}`],
  );
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
  await client.connect(publicClient as any, walletClient);

  const result = await client.encryptInputs([
    Encryptable.uint128(memoryHash),
    Encryptable.uint64(lastInteraction),
  ]).encrypt();

  if (!result.success) {
    throw new Error(`Encryption failed: ${result.error.message}`);
  }

  return {
    inMemoryHash: toBytes(result.data[0]),
    inLastInteraction: toBytes(result.data[1]),
  };
}
