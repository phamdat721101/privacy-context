import { Encryptable } from '@cofhe/sdk';
import { encodeAbiParameters } from 'viem';
import { getAgentCofheClient } from './agentClient';
import { getBlockchainService } from '../services/blockchainService';

function toBytes(input: { ctHash: bigint; securityZone: number; utype: number; signature: string }): `0x${string}` {
  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint8' }, { type: 'uint8' }, { type: 'bytes' }],
    [input.ctHash, input.securityZone, input.utype, input.signature as `0x${string}`],
  );
}

export async function writeEncryptedMemory(userAddress: string, memoryHash: bigint) {
  const client = await getAgentCofheClient();
  const chain = getBlockchainService();
  const lastInteraction = BigInt(Math.floor(Date.now() / 1000));

  const result = await client.encryptInputs([
    Encryptable.uint128(memoryHash),
    Encryptable.uint64(lastInteraction),
  ]).encrypt();

  if (!result.success) throw new Error(`Encryption failed: ${result.error.message}`);

  return chain.updateMemory(
    userAddress,
    toBytes(result.data[0]),
    toBytes(result.data[1]),
  );
}
