'use client';
import { PrivyProvider } from '@privy-io/react-auth';
import { WagmiProvider } from '@privy-io/wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PRIVY_APP_ID, privyConfig } from '@/lib/privy';
import { wagmiConfig } from '@/lib/wagmi';
import { SuiProviders } from '@/lib/sui';

const queryClient = new QueryClient();

/**
 * Provider stack:
 *   PrivyProvider                 — EVM wallet auth (humans, embedded + injected)
 *     QueryClientProvider         — shared between wagmi (EVM) + dapp-kit (Sui)
 *       WagmiProvider             — EVM RPC + viem clients
 *         SuiProviders            — Sui RPC + dapp-kit wallet adapters
 *           {children}            — every page can use both EVM and Sui hooks
 *
 * Putting `SuiProviders` *inside* `WagmiProvider` (rather than parallel) keeps
 * a single React subtree — both wallet stacks coexist without a context wars
 * scenario. Sui providers are mounted globally because `NetworkSwitcher` (top
 * bar) needs `useCurrentWallet()` regardless of route.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <SuiProviders>{children}</SuiProviders>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
