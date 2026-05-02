import { Encryptable } from '@cofhe/sdk';
import { encodeAbiParameters, createPublicClient, http, type WalletClient } from 'viem';
import { arbitrumSepolia as viemArbSepolia } from 'viem/chains';
import { getCofheClient } from '../client/cofheClient';
import type { SupportedChain } from '../client/chains';
import type { PaymentEvent, SealedPaymentEvent } from './types';

function toBytes(input: { ctHash: bigint; securityZone: number; utype: number; signature: string }): `0x${string}` {
  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint8' }, { type: 'uint8' }, { type: 'bytes' }],
    [input.ctHash, input.securityZone, input.utype, input.signature as `0x${string}`],
  );
}

function hashString(s: string): bigint {
  let h = 0n;
  for (let i = 0; i < Math.min(s.length, 32); i++) h = (h << 8n) | BigInt(s.charCodeAt(i));
  return h;
}

export class ContextSeal {
  async seal(
    event: PaymentEvent, chain: SupportedChain, walletClient: WalletClient,
  ): Promise<SealedPaymentEvent> {
    const client = getCofheClient();
    const publicClient = createPublicClient({ chain: viemArbSepolia, transport: http(chain.rpcUrl) });
    await client.connect(publicClient as any, walletClient);

    const result = await client.encryptInputs([
      Encryptable.uint128(hashString(event.url)),
      Encryptable.uint64(BigInt(event.durationMs)),
      Encryptable.bool(event.success),
    ]).encrypt();

    if (!result.success) throw new Error(`Context seal failed: ${result.error.message}`);

    return {
      protocol: event.protocol,
      chain: event.chain,
      timestamp: event.timestamp,
      encrypted: {
        urlHash: toBytes(result.data[0]),
        durationMs: toBytes(result.data[1]),
        success: toBytes(result.data[2]),
      },
    };
  }
}
