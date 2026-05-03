import { createPublicClient, http, type WalletClient } from 'viem';
import { PermitUtils } from '@cofhe/sdk/permits';
import { arbitrumSepolia as viemArbitrumSepolia, arbitrum as viemArbitrum } from 'viem/chains';
import type { SupportedChain } from '../client/chains';
import { getCofheClient } from '../client/cofheClient';

export interface PermitOptions {
  contractAddress: `0x${string}`;
  agentAddress: `0x${string}`;
}

export async function createPermit(
  options: PermitOptions,
  chain: SupportedChain,
  signer: WalletClient,
): Promise<string> {
  const client = getCofheClient();

  const account = signer.account?.address
    ?? (await signer.getAddresses())[0];
  if (!account) throw new Error('No account found in wallet client');

  const viemChain = chain.id === 421614 ? viemArbitrumSepolia : viemArbitrum;
  const publicClient = createPublicClient({ chain: viemChain, transport: http(chain.rpcUrl) });
  await client.connect(publicClient as any, signer as any);

  const permit = account.toLowerCase() === options.agentAddress.toLowerCase()
    ? await client.permits.getOrCreateSelfPermit()
    : await client.permits.createSharing({
        issuer: account,
        recipient: options.agentAddress,
        name: `agent-permit-${options.agentAddress.slice(0, 8)}`,
      });

  return PermitUtils.export(permit);
}
