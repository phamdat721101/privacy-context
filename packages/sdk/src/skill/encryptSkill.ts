import { Encryptable } from '@cofhe/sdk';
import { createPublicClient, http, encodeAbiParameters, type WalletClient } from 'viem';
import { arbitrumSepolia as viemArbSepolia, arbitrum as viemArbitrum } from 'viem/chains';
import type { SupportedChain } from '../client/chains';
import { getCofheClient } from '../client/cofheClient';
import type { RawSkillListing, RawSkillPurchase } from './skillTypes';

function toBytes(input: { ctHash: bigint; securityZone: number; utype: number; signature: string }): `0x${string}` {
  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint8' }, { type: 'uint8' }, { type: 'bytes' }],
    [input.ctHash, input.securityZone, input.utype, input.signature as `0x${string}`],
  );
}

export interface EncryptedSkillListingInputs {
  inSkillId: `0x${string}`;
  inDeveloper: `0x${string}`;
  inBasePrice: `0x${string}`;
  inMaxSupply: `0x${string}`;
}

export interface EncryptedSkillPurchaseInputs {
  inPaymentAmount: `0x${string}`;
  inAgentOwner: `0x${string}`;
}

async function connectClient(chain: SupportedChain, walletClient: WalletClient) {
  const client = getCofheClient();
  const viemChain = chain.id === 421614 ? viemArbSepolia : viemArbitrum;
  const publicClient = createPublicClient({ chain: viemChain, transport: http(chain.rpcUrl) });
  await client.connect(publicClient as any, walletClient);
  return client;
}

export async function encryptSkillListing(
  raw: RawSkillListing,
  chain: SupportedChain,
  walletClient: WalletClient,
): Promise<EncryptedSkillListingInputs> {
  const client = await connectClient(chain, walletClient);

  async function enc(item: any) {
    const r = await client.encryptInputs([item]).encrypt();
    if (!r.success) throw new Error('Encryption failed: ' + r.error.message);
    return toBytes(r.data[0] as any);
  }

  const [inSkillId, inDeveloper, inBasePrice, inMaxSupply] = await Promise.all([
    enc(Encryptable.uint32(BigInt(raw.skillId))),
    enc(Encryptable.address(raw.developerAddress)),
    enc(Encryptable.uint64(raw.basePriceUSDC)),
    enc(Encryptable.uint32(BigInt(raw.maxLicenses))),
  ]);

  return { inSkillId, inDeveloper, inBasePrice, inMaxSupply };
}

export async function encryptSkillPurchase(
  raw: RawSkillPurchase,
  chain: SupportedChain,
  walletClient: WalletClient,
): Promise<EncryptedSkillPurchaseInputs> {
  const client = await connectClient(chain, walletClient);

  async function enc(item: any) {
    const r = await client.encryptInputs([item]).encrypt();
    if (!r.success) throw new Error('Encryption failed: ' + r.error.message);
    return toBytes(r.data[0] as any);
  }

  const [inPaymentAmount, inAgentOwner] = await Promise.all([
    enc(Encryptable.uint64(raw.paymentAmountUSDC)),
    enc(Encryptable.address(raw.agentWalletAddress)),
  ]);

  return { inPaymentAmount, inAgentOwner };
}
