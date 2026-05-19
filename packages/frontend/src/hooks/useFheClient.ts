'use client';
import { useRef, useState, useCallback, useEffect } from 'react';
import { useWallets } from '@privy-io/react-auth';

/**
 * useFheClient — singleton React hook wrapping @cofhe/sdk/web.
 *
 * Lifecycle: createCofheConfig → createCofheClient → connect(publicClient, walletClient)
 * Lazy-loads the WASM module only when first called (saves ~3MB on initial page load).
 *
 * Exposes:
 *   - client: the connected CofheClient (null until ready)
 *   - ready: boolean
 *   - error: string | null
 *   - ensurePermit(): creates self-permit if not already present
 */

type CofheClient = any; // SDK types are complex; we use `any` for the hook surface

let _clientPromise: Promise<CofheClient> | null = null;
let _client: CofheClient | null = null;

export function useFheClient() {
  const { wallets } = useWallets();
  const [ready, setReady] = useState(!!_client);
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);

  const init = useCallback(async () => {
    if (_client || _clientPromise || !wallets[0]) return;
    initRef.current = true;

    _clientPromise = (async () => {
      try {
        // Dynamic import — WASM only loads when needed
        const { createCofheConfig, createCofheClient } = await import('@cofhe/sdk/web');
        const { chains } = await import('@cofhe/sdk/chains');
        const { createPublicClient, createWalletClient, custom, http } = await import('viem');
        const { arbitrumSepolia } = await import('viem/chains');

        const config = createCofheConfig({ supportedChains: [chains.arbSepolia] });
        const client = createCofheClient(config);

        const provider = await wallets[0].getEthereumProvider();
        const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http() });
        const walletClient = createWalletClient({ chain: arbitrumSepolia, transport: custom(provider) });

        await client.connect(publicClient as any, walletClient as any);
        _client = client;
        setReady(true);
        return client;
      } catch (e: any) {
        setError(e.message);
        _clientPromise = null;
        throw e;
      }
    })();

    return _clientPromise;
  }, [wallets]);

  useEffect(() => {
    if (wallets[0] && !_client && !initRef.current) {
      init();
    }
  }, [wallets, init]);

  const ensurePermit = useCallback(async () => {
    const c = _client ?? (await _clientPromise);
    if (!c) throw new Error('FHE client not initialized');
    await c.permits.getOrCreateSelfPermit();
  }, []);

  return { client: _client, ready, error, ensurePermit, init };
}
