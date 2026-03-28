import type { PrivyClientConfig } from '@privy-io/react-auth';

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';

export const privyConfig: PrivyClientConfig = {
  loginMethods: ['email', 'wallet', 'google'],
  appearance: {
    theme: 'dark',
    accentColor: '#E94560',
  },
  embeddedWallets: {
    createOnLogin: 'users-without-wallets',
  },
};
