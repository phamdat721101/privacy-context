'use client';
import { PrivyProvider } from '@privy-io/react-auth';
import { WagmiProvider } from '@privy-io/wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PRIVY_APP_ID, privyConfig } from '@/lib/privy';
import { wagmiConfig } from '@/lib/wagmi';

const queryClient = new QueryClient();

/**
 * Provider stack (single-chain post-Sui-removal):
 *   PrivyProvider                 — EVM wallet auth (humans, embedded + injected)
 *     QueryClientProvider         — react-query for SWR-style data
 *       WagmiProvider             — EVM RPC + viem clients
 *         {children}
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
