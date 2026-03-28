import { createConfig } from '@privy-io/wagmi';
import { http } from 'wagmi';
import { arbitrum, arbitrumSepolia } from 'wagmi/chains';

export const wagmiConfig = createConfig({
  chains: [arbitrumSepolia, arbitrum],
  transports: {
    [arbitrumSepolia.id]: http(),
    [arbitrum.id]: http(),
  },
});
