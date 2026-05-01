import { Encryptable } from '@cofhe/sdk';
import { createPublicClient, http, encodeAbiParameters, type WalletClient } from 'viem';
import { arbitrumSepolia as viemArbSepolia, arbitrum as viemArbitrum } from 'viem/chains';
import type { SupportedChain } from '../client/chains';
import { getCofheClient } from '../client/cofheClient';
import type { RawInvoice, RawPayment, RawSubscription } from './paymentTypes';

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

export interface EncryptedInvoiceInputs {
  inAmount: `0x${string}`;
  inRecipient: `0x${string}`;
}

export interface EncryptedPaymentInputs {
  inAmount: `0x${string}`;
}

export interface EncryptedSubscriptionInputs {
  inAmount: `0x${string}`;
  inRecipient: `0x${string}`;
}

export async function encryptInvoice(
  raw: RawInvoice, chain: SupportedChain, walletClient: WalletClient,
): Promise<EncryptedInvoiceInputs> {
  const client = await connectClient(chain, walletClient);
  async function enc(item: any) {
    const r = await client.encryptInputs([item]).encrypt();
    if (!r.success) throw new Error('Encryption failed: ' + r.error.message);
    return toBytes(r.data[0] as any);
  }
  const [inAmount, inRecipient] = await Promise.all([
    enc(Encryptable.uint64(raw.amount)),
    enc(Encryptable.address(raw.recipientAddress)),
  ]);
  return { inAmount, inRecipient };
}

export async function encryptPayment(
  raw: RawPayment, chain: SupportedChain, walletClient: WalletClient,
): Promise<EncryptedPaymentInputs> {
  const client = await connectClient(chain, walletClient);
  const result = await client.encryptInputs([Encryptable.uint64(raw.amount)]).encrypt();
  if (!result.success) throw new Error(`Encryption failed: ${result.error.message}`);
  return { inAmount: toBytes(result.data[0]) };
}

export async function encryptSubscription(
  raw: RawSubscription, chain: SupportedChain, walletClient: WalletClient,
): Promise<EncryptedSubscriptionInputs> {
  const client = await connectClient(chain, walletClient);
  async function enc(item: any) {
    const r = await client.encryptInputs([item]).encrypt();
    if (!r.success) throw new Error('Encryption failed: ' + r.error.message);
    return toBytes(r.data[0] as any);
  }
  const [inAmount, inRecipient] = await Promise.all([
    enc(Encryptable.uint64(raw.amount)),
    enc(Encryptable.address(raw.recipientAddress)),
  ]);
  return { inAmount, inRecipient };
}
