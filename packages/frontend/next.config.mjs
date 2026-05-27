/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  experimental: {
    // Load @cofhe/sdk natively via Node.js so WASM resolves from node_modules,
    // instead of being bundled by webpack into the wrong server path.
    serverComponentsExternalPackages: ['@cofhe/sdk'],
  },
  webpack: (config) => {
    // Stub the React Native storage module pulled in by @metamask/sdk → @wagmi/connectors.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': false,
    };
    config.resolve.fallback = { fs: false, net: false, tls: false };
    // Enable async WebAssembly for the client bundle (TFHE used by CoFHE SDK).
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };
    return config;
  },
  // Legacy → fhedin URL map. All temporary (308) so search engines don't
  // freeze a stale redirect once the rewrite settles.
  // NOTE: /memory is intentionally NOT in this list — it now hosts the Arkiv
  //       Memory Tier (Web3 Database Builder Challenge). Do not re-add it.
  // NOTE: /brain is intentionally NOT in this list — it now hosts the
  //       Cognitive Memory v1 surface (L1/L2/L3, Fhenix-encrypted, Postgres-
  //       backed). The old "/brain → /studio" alias was a different feature
  //       and has been retired. Do not re-add it.
  async redirects() {
    return [
      { source: '/onboard', destination: '/docs', permanent: false },
      { source: '/payments', destination: '/settings', permanent: false },
      { source: '/v2', destination: '/', permanent: false },
      { source: '/zama-demo', destination: '/', permanent: false },
      { source: '/catalog', destination: '/marketplace', permanent: false },
      { source: '/settings-v2', destination: '/settings', permanent: false },
      // Bare /chat with no agent goes back to discovery.
      { source: '/chat', destination: '/marketplace', permanent: false },
    ];
  },
};

export default config;
