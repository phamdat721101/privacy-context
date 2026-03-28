import { createCofhesdkConfig, createCofhesdkClient } from '@cofhe/sdk/web';
import { arbSepolia } from '@cofhe/sdk/chains';
import type { SupportedChain } from './chains';

let _client: ReturnType<typeof createCofhesdkClient> | null = null;

export function getCofheClient(_chain?: SupportedChain) {
  if (_client) return _client;
  const config = createCofhesdkConfig({
    supportedChains: [arbSepolia],
  });
  _client = createCofhesdkClient(config);
  return _client;
}

export function resetCofheClient() {
  _client = null;
}
