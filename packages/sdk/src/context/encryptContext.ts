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

  // Encrypt each field individually to avoid CoFHE ZK proof deserialization
  // errors when packing too many mixed FHE types in a single proof batch.
  async function enc(item: any) {
    const r = await client.encryptInputs([item]).encrypt();
    if (!r.success) throw new Error('Encryption failed: ' + r.error.message);
    return toBytes(r.data[0] as any);
  }

  const [inSessionKey, inUserId, inSentimentScore, inTrustLevel, inIsVerified, inAuthorizedAgent] =
    await Promise.all([
      enc(Encryptable.uint128(raw.sessionKey)),
      enc(Encryptable.uint64(raw.userId)),
      enc(Encryptable.uint8(BigInt(raw.sentimentScore))),
      enc(Encryptable.uint8(BigInt(raw.trustLevel))),
      enc(Encryptable.bool(raw.isVerified)),
      enc(Encryptable.address(raw.authorizedAgent)),
    ]);

  return { inSessionKey, inUserId, inSentimentScore, inTrustLevel, inIsVerified, inAuthorizedAgent };
}
