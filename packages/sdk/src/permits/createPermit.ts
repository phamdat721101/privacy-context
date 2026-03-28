import { createPublicClient, http, type WalletClient } from 'viem';
import { arbitrumSepolia as viemArbitrumSepolia, arbitrum as viemArbitrum } from 'viem/chains';
import type { SupportedChain } from '../client/chains';
import { getCofheClient } from '../client/cofheClient';

export interface PermitOptions {
  contractAddress: `0x${string}`;
  agentAddress: `0x${string}`;
  /** Duration in seconds. Defaults to 7 days. */
  durationSeconds?: number;
}

export async function createPermit(
  options: PermitOptions,
  chain: SupportedChain,
  signer: WalletClient,
): Promise<any> {
  const client = getCofheClient();
  const walletClient = signer;

  const account = walletClient.account?.address
    ?? (await walletClient.getAddresses())[0];

  if (!account) throw new Error('No account found in wallet client');

  const viemChain = chain.id === 421614 ? viemArbitrumSepolia : viemArbitrum;
  const publicClient = createPublicClient({ chain: viemChain, transport: http(chain.rpcUrl) });
  await client.connect(publicClient as any, walletClient);

  const duration = options.durationSeconds ?? 7 * 24 * 60 * 60;

  const result = await client.permits.createSharing({
    type: 'sharing',
    issuer: account,
    recipient: options.agentAddress,
    expiration: Math.floor(Date.now() / 1000) + duration,
  });

  if (!result.success) {
    throw new Error(`Permit creation failed: ${result.error.message}`);
  }

  return result.data;
}
