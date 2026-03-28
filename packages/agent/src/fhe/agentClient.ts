import { createCofhesdkConfig, createCofhesdkClient } from '@cofhe/sdk/node';
import { arbSepolia } from '@cofhe/sdk/chains';

import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';

let _client: ReturnType<typeof createCofhesdkClient> | null = null;
let _isConnected = false;

export async function getAgentCofheClient() {
  if (!_client) {
    const config = createCofhesdkConfig({
      supportedChains: [arbSepolia],
    });
    _client = createCofhesdkClient(config);
  }

  if (!_isConnected) {
    const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`);
    const publicClient = createPublicClient({
      chain: arbitrumSepolia,
      transport: http(process.env.RPC_URL_ARBITRUM_SEPOLIA),
    });
    const walletClient = createWalletClient({
      account,
      chain: arbitrumSepolia,
      transport: http(process.env.RPC_URL_ARBITRUM_SEPOLIA),
    });

    await _client.connect(publicClient as any, walletClient as any);
    _isConnected = true;
  }

  return _client;
}

export async function importAgentPermit(serializedPermit: string): Promise<any> {
  const client = await getAgentCofheClient();
  const result = await client.permits.importShared(serializedPermit);
  if (!result.success) {
    throw new Error(`Import permit failed: ${result.error.message}`);
  }
  return result.data;
}

export async function revokeAgentPermit(permitHash: string): Promise<void> {
  const client = await getAgentCofheClient();
  const result = await client.permits.removePermit(permitHash);
  if (!result.success) {
    throw new Error(`Revoke permit failed: ${result.error.message}`);
  }
}
