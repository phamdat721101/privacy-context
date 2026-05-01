import { Encryptable } from '@cofhe/sdk';
import { createPublicClient, http, encodeAbiParameters, type WalletClient } from 'viem';
import { arbitrumSepolia as viemArbSepolia, arbitrum as viemArbitrum } from 'viem/chains';
import type { SupportedChain } from '../client/chains';
import { getCofheClient } from '../client/cofheClient';

function toBytes(input: { ctHash: bigint; securityZone: number; utype: number; signature: string }): `0x${string}` {
  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint8' }, { type: 'uint8' }, { type: 'bytes' }],
    [input.ctHash, input.securityZone, input.utype, input.signature as `0x${string}`],
  );
}

async function connectClient(chain: SupportedChain, walletClient: WalletClient) {
  const client = getCofheClient();
  const viemChain = chain.id === 421614 ? viemArbSepolia : viemArbitrum;
  const publicClient = createPublicClient({ chain: viemChain, transport: http(chain.rpcUrl) });
  await client.connect(publicClient as any, walletClient);
  return client;
}

export async function encryptTopUp(
  amount: bigint, chain: SupportedChain, walletClient: WalletClient,
): Promise<{ inAmount: `0x${string}` }> {
  const client = await connectClient(chain, walletClient);
  const result = await client.encryptInputs([Encryptable.uint64(amount)]).encrypt();
  if (!result.success) throw new Error(`Encryption failed: ${result.error.message}`);
  return { inAmount: toBytes(result.data[0]) };
}

export async function encryptSettlementRecord(
  amount: bigint, reasonHash: bigint, chain: SupportedChain, walletClient: WalletClient,
): Promise<{ inAmount: `0x${string}`; inReasonHash: `0x${string}` }> {
  const client = await connectClient(chain, walletClient);
  async function enc(item: any) {
    const r = await client.encryptInputs([item]).encrypt();
    if (!r.success) throw new Error('Encryption failed: ' + r.error.message);
    return toBytes(r.data[0] as any);
  }
  const [inAmount, inReasonHash] = await Promise.all([
    enc(Encryptable.uint64(amount)),
    enc(Encryptable.uint128(reasonHash)),
  ]);
  return { inAmount, inReasonHash };
}
