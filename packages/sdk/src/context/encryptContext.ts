import { Encryptable } from '@cofhe/sdk';
import { createPublicClient, http, encodeAbiParameters, type WalletClient } from 'viem';
import { arbitrumSepolia as viemArbSepolia, arbitrum as viemArbitrum } from 'viem/chains';
import type { RawContext } from './contextTypes';
import type { SupportedChain } from '../client/chains';
import { getCofheClient } from '../client/cofheClient';

export interface EncryptedContextInputs {
  inSessionKey: `0x${string}`;
  inUserId: `0x${string}`;
  inSentimentScore: `0x${string}`;
  inTrustLevel: `0x${string}`;
  inIsVerified: `0x${string}`;
  inAuthorizedAgent: `0x${string}`;
}

function toBytes(input: { ctHash: bigint; securityZone: number; utype: number; signature: string }): `0x${string}` {
  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint8' }, { type: 'uint8' }, { type: 'bytes' }],
    [input.ctHash, input.securityZone, input.utype, input.signature as `0x${string}`],
  );
}

export async function encryptContext(
  raw: RawContext,
  chain: SupportedChain,
  contractAddress: `0x${string}`,
  walletClient: WalletClient,
): Promise<EncryptedContextInputs> {
  const client = getCofheClient();

  const viemChain = chain.id === 421614 ? viemArbSepolia : viemArbitrum;
  const publicClient = createPublicClient({ chain: viemChain, transport: http(chain.rpcUrl) });
  await client.connect(publicClient as any, walletClient);

  const encryptedResult = await client.encryptInputs([
    Encryptable.uint128(raw.sessionKey),
    Encryptable.uint64(raw.userId),
    Encryptable.uint8(BigInt(raw.sentimentScore)),
    Encryptable.uint8(BigInt(raw.trustLevel)),
    Encryptable.bool(raw.isVerified),
    Encryptable.address(raw.authorizedAgent),
  ]).encrypt();

  if (!encryptedResult.success) {
    throw new Error(`Encryption failed: ${encryptedResult.error.message}`);
  }

  const inputs = encryptedResult.data;

  return {
    inSessionKey: toBytes(inputs[0]),
    inUserId: toBytes(inputs[1]),
    inSentimentScore: toBytes(inputs[2]),
    inTrustLevel: toBytes(inputs[3]),
    inIsVerified: toBytes(inputs[4]),
    inAuthorizedAgent: toBytes(inputs[5]),
  };
}
